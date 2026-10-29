// POST /elements
//
// Dos cosas por la misma ruta (requirements.md, requisitos 1 y 2):
//   - { altarId, tipo, ... }              pone un elemento  -> 201
//   - { altarId, borrar: true, id }       lo quita          -> 200 / 404
//
// La API pone id, creadoEn, posicion y sk. No confia en que el cliente los mande.

import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const TABLA = process.env.TABLA

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

/**
 * Todos los items de un altar que cumplen un filtro, pagina por pagina.
 *
 * Sin Limit a proposito: DynamoDB aplica Limit ANTES de FilterExpression,
 * asi que con Limit un item que si existe puede quedarse fuera de la pagina.
 */
async function buscar(altarId, filtro, nombres, valores, proyeccion) {
  const items = []
  let desde
  do {
    const pagina = await db.send(
      new QueryCommand({
        TableName: TABLA,
        KeyConditionExpression: 'altarId = :a',
        FilterExpression: filtro,
        ExpressionAttributeNames: nombres,
        ExpressionAttributeValues: { ':a': altarId, ...valores },
        ProjectionExpression: proyeccion,
        ExclusiveStartKey: desde,
      }),
    )
    items.push(...(pagina.Items || []))
    desde = pagina.LastEvaluatedKey
  } while (desde)
  return items
}

/** Solo los campos que el cliente puede mandar. Lo demas se ignora. */
function camposPermitidos(cuerpo) {
  const el = { tipo: cuerpo.tipo }
  if (cuerpo.nivel !== undefined && Number.isFinite(Number(cuerpo.nivel))) {
    el.nivel = Number(cuerpo.nivel)
  }
  if (typeof cuerpo.texto === 'string' && cuerpo.texto) el.texto = cuerpo.texto.slice(0, 280)
  if (typeof cuerpo.link === 'string' && cuerpo.link.startsWith('https://')) el.link = cuerpo.link
  if (typeof cuerpo.puestoPor === 'string' && cuerpo.puestoPor) {
    el.puestoPor = cuerpo.puestoPor.slice(0, 40)
  }
  if (typeof cuerpo.imageKey === 'string' && cuerpo.imageKey) el.imageKey = cuerpo.imageKey
  return el
}

async function quitar(altarId, id) {
  const [item] = await buscar(altarId, '#id = :id', { '#id': 'id', '#sk': 'sk' }, { ':id': id }, '#sk')
  if (!item) return respuesta(404, { error: 'Ese elemento no está en este altar.' })

  await db.send(new DeleteCommand({ TableName: TABLA, Key: { altarId, sk: item.sk } }))
  return respuesta(200, { borrado: id })
}

async function poner(altarId, cuerpo) {
  const elemento = camposPermitidos(cuerpo)

  // posicion = cuantos hay ya en ese nivel.
  const delNivel = await buscar(
    altarId,
    '#nivel = :n',
    { '#nivel': 'nivel', '#id': 'id' },
    { ':n': elemento.nivel ?? null },
    '#id',
  )

  const id = randomUUID()
  const creadoEn = new Date().toISOString()
  const guardado = { altarId, ...elemento, posicion: delNivel.length, id, creadoEn }

  await db.send(
    new PutCommand({ TableName: TABLA, Item: { ...guardado, sk: `${creadoEn}#${id}` } }),
  )
  // Se responde sin sk: es interna.
  return respuesta(201, guardado)
}

export async function handler(event) {
  let cuerpo
  try {
    cuerpo = JSON.parse(event.body || '{}')
  } catch {
    return respuesta(400, { error: 'El cuerpo no es JSON válido.' })
  }
  if (!cuerpo || typeof cuerpo !== 'object') {
    return respuesta(400, { error: 'El cuerpo no es JSON válido.' })
  }

  const { altarId } = cuerpo
  if (typeof altarId !== 'string' || !altarId) return respuesta(400, { error: 'Falta altarId.' })

  try {
    if (cuerpo.borrar === true) {
      if (typeof cuerpo.id !== 'string' || !cuerpo.id) {
        return respuesta(400, { error: 'Falta el id a borrar.' })
      }
      return await quitar(altarId, cuerpo.id)
    }

    if (typeof cuerpo.tipo !== 'string' || !cuerpo.tipo) {
      return respuesta(400, { error: 'Falta tipo.' })
    }
    return await poner(altarId, cuerpo)
  } catch (err) {
    console.error(err)
    return respuesta(500, { error: 'No pude guardar el cambio en el altar.' })
  }
}
