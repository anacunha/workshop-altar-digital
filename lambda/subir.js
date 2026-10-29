// Las imagenes NO pasan por esta Lambda. Aqui solo se firman URLs:
//
//   POST /uploads              { altarId, contentType } -> { url, imageKey }
//                              URL para un PUT directo a S3, caduca en 5 min.
//   GET  /uploads/<imageKey>   -> { url }
//                              URL de lectura, caduca en 1 hora.
//
// El bucket es privado: sin una de estas URLs, una imagen no se ve.

import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// WHEN_REQUIRED: sin esto el SDK firma el checksum de un cuerpo vacio y el
// PUT del navegador (con la foto de verdad) falla la firma.
const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' })
const BUCKET = process.env.BUCKET

/** Los unicos tipos que se aceptan, con la extension de su llave. */
const EXTENSIONES = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function respuesta(statusCode, cuerpo) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(cuerpo),
  }
}

async function firmarLectura(event) {
  const imageKey = event.pathParameters?.proxy
  if (!imageKey) return respuesta(400, { error: 'Falta la imageKey.' })

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: imageKey }), {
    expiresIn: 60 * 60,
  })
  return respuesta(200, { url })
}

async function firmarSubida(event) {
  let cuerpo
  try {
    cuerpo = JSON.parse(event.body || '{}')
  } catch {
    return respuesta(400, { error: 'El cuerpo no es JSON válido.' })
  }

  const { altarId, contentType } = cuerpo || {}
  if (typeof altarId !== 'string' || !altarId) return respuesta(400, { error: 'Falta altarId.' })

  const ext = EXTENSIONES[contentType]
  if (!ext) {
    return respuesta(400, { error: 'Solo se aceptan imágenes jpeg, png, webp o gif.' })
  }

  const imageKey = `${altarId}/${randomUUID()}.${ext}`
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: imageKey, ContentType: contentType }),
    { expiresIn: 5 * 60 },
  )
  return respuesta(200, { url, imageKey })
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'GET') return await firmarLectura(event)
    if (event.httpMethod === 'POST') return await firmarSubida(event)
    return respuesta(405, { error: 'Método no permitido.' })
  } catch (err) {
    console.error(err)
    return respuesta(500, { error: 'No pude firmar la URL de la imagen.' })
  }
}
