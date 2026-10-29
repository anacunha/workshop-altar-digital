// Donde se guarda el altar.
//
// ---------------------------------------------------------------------
//  ESTE ES EL UNICO ARCHIVO QUE CAMBIA EN EL MODULO 3.
// ---------------------------------------------------------------------
//
// Ahora el altar vive en TU API: una tabla de DynamoDB para los elementos y
// un bucket privado de S3 para las imagenes. Las cuatro funciones de abajo
// mantienen la firma que tenian con localStorage, asi que ningun componente
// cambio ni una linea.
//
// `agregar` sigue recibiendo el File crudo de la imagen. Antes lo volvia
// data URL; ahora lo reduce a Blob, pide una URL firmada y lo sube directo
// a S3. La imagen nunca pasa por la Lambda: el elemento solo guarda su
// `imageKey`.

import { reducirABlob } from "../lib/imagen.js";

// Este archivo le habla a la API, siempre. El banner de la pagina lo lee de
// aqui para decir la verdad sobre donde vive el altar.
export const MODO = "nube";

// La URL de la API sale del entorno (Amplify o tu .env), nunca del codigo.
// Sin diagonal final, para armar las rutas sin dobles //.
const API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

// El altar es el hostname de la pagina: la misma URL abre el mismo altar en
// la laptop y en el telefono, porque los dos consultan la misma particion.
const ALTAR_ID = window.location.hostname;

const LLAVE = "ofrenda:elementos";
const LLAVE_IMPORTADO = "ofrenda:importado";
const LLAVE_NOMBRE = "ofrenda:nombre";

/** Llama a la API y devuelve el JSON. Si falla, lanza el error que dio. */
async function pedir(ruta, opciones = {}) {
  if (!API) {
    throw new Error("Falta VITE_API_URL: no sé dónde está tu API.");
  }
  const res = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(cuerpo.error || `La API respondió ${res.status}.`);
  }
  return cuerpo;
}

function enviar(ruta, datos) {
  return pedir(ruta, { method: "POST", body: JSON.stringify(datos) });
}

/**
 * Sube una imagen a S3 y devuelve su imageKey.
 *
 * Dos pasos: la API firma una URL de PUT (caduca en 5 min) y el navegador
 * sube los bytes directo al bucket con esa URL.
 */
async function subirImagen(blob) {
  const { url, imageKey } = await enviar("/uploads", {
    altarId: ALTAR_ID,
    contentType: blob.type,
  });
  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  if (!put.ok) throw new Error("No pude subir la imagen.");
  return imageKey;
}

async function pedirLista() {
  const { elementos } = await pedir(
    `/elements?altarId=${encodeURIComponent(ALTAR_ID)}`,
  );
  return elementos || [];
}

/**
 * Pasa a la API el altar que ya estaba en el localStorage de este navegador.
 *
 * Solo corre una vez: si la API esta vacia y este navegador tiene la lista
 * `ofrenda:elementos`. Las fotos guardadas como data URL se vuelven Blob y
 * se suben a S3. El localStorage NO se borra: puede ser el altar de alguien.
 */
async function importarDeEsteNavegador() {
  let lista = [];
  try {
    const crudo = localStorage.getItem(LLAVE);
    lista = crudo ? JSON.parse(crudo) : [];
  } catch {
    console.warn("No pude leer el altar guardado en este navegador.");
  }
  if (!Array.isArray(lista)) lista = [];

  // En orden, uno por uno, para que la API calcule bien la posicion en cada nivel.
  const ordenada = [...lista].sort((a, b) =>
    (a.creadoEn || "").localeCompare(b.creadoEn || ""),
  );
  for (const el of ordenada) {
    const { imagenLocal, id, creadoEn, posicion, ...resto } = el;
    const datos = { ...resto, altarId: ALTAR_ID };
    if (imagenLocal) {
      const blob = await (await fetch(imagenLocal)).blob();
      datos.imageKey = await subirImagen(blob);
    }
    await enviar("/elements", datos);
  }
  localStorage.setItem(LLAVE_IMPORTADO, "si");
}

// Si la pagina pide la lista dos veces a la vez, se importa una sola.
let importacion = null;

/** Todos los elementos del altar, ordenados por cuando se pusieron. */
export async function listar() {
  const lista = await pedirLista();
  if (lista.length > 0 || localStorage.getItem(LLAVE_IMPORTADO)) return lista;

  importacion ??= importarDeEsteNavegador().finally(() => {
    importacion = null;
  });
  await importacion;
  return pedirLista();
}

/**
 * Agrega un elemento y devuelve como quedo guardado.
 *
 * Si trae `imagen` (el File del formulario), aqui se reduce, se sube a S3
 * y el elemento se guarda solo con su `imageKey`.
 */
export async function agregar(elemento) {
  const { imagen, ...resto } = elemento;
  const datos = { ...resto, altarId: ALTAR_ID };
  if (imagen) datos.imageKey = await subirImagen(await reducirABlob(imagen));
  return enviar("/elements", datos);
}

/** Quita un elemento del altar. */
export async function borrar(id) {
  await enviar("/elements", { altarId: ALTAR_ID, borrar: true, id });
}

/**
 * De donde sale la imagen de un elemento.
 *
 * El bucket es privado: la API firma una URL de lectura que caduca en 1 hora.
 */
export async function urlDeImagen(elemento) {
  if (!elemento.imageKey) return null;
  const { url } = await pedir(`/uploads/${elemento.imageKey}`);
  return url || null;
}

/** Quien esta poniendo cosas en el altar. Se pregunta una sola vez. */
export function nombre() {
  return localStorage.getItem(LLAVE_NOMBRE) || "";
}

export function guardarNombre(valor) {
  localStorage.setItem(LLAVE_NOMBRE, valor.slice(0, 40));
}
