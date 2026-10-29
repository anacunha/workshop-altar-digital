// GET /elements?altarId=...
//
// Trae los elementos de UN altar con un Query por su partition key. Nunca
// Scan: un Scan lee la tabla entera, incluidos los altares de los demas.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

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

export async function handler(event) {
  const altarId = event.queryStringParameters?.altarId
  if (!altarId) return respuesta(400, { error: 'Falta altarId.' })

  try {
    const { Items = [] } = await db.send(
      new QueryCommand({
        TableName: TABLA,
        KeyConditionExpression: 'altarId = :a',
        ExpressionAttributeValues: { ':a': altarId },
        // La sk empieza con la fecha: ascendente = en el orden en que se pusieron.
        ScanIndexForward: true,
        Limit: 200,
      }),
    )
    // La sk es interna: no sale de la API.
    const elementos = Items.map(({ sk, ...resto }) => resto)
    return respuesta(200, { elementos })
  } catch (err) {
    console.error(err)
    return respuesta(500, { error: 'No pude leer el altar.' })
  }
}
