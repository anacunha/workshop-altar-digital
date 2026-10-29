// El stack del altar.
//
// Todo el backend vive aqui (design.md, Architecture / Data Models /
// Components and Interfaces):
//
//   - una tabla de DynamoDB (partition key altarId, sort key sk)
//   - un bucket privado de S3 para las imagenes
//   - tres Lambdas en JavaScript plano (lambda/), sin bundler
//   - una REST API con GET/POST /elements, POST /uploads y GET /uploads/{proxy+}
//
// Cada Lambda recibe permisos solo sobre la tabla o el bucket que usa.

import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import { Construct } from 'constructs'

export class OfrendaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // -----------------------------------------------------------------
    // La tabla. La llave (altarId + sk) NO se toca: cambiarla reemplaza
    // la tabla y se lleva los elementos del altar.
    // -----------------------------------------------------------------
    const tabla = new dynamodb.Table(this, 'Elementos', {
      tableName: 'ofrenda-elementos',
      partitionKey: { name: 'altarId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // DESTROY para que el cierre del taller la borre. En un proyecto real: RETAIN.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // -----------------------------------------------------------------
    // El bucket de imagenes. Privado: una imagen solo se ve con URL firmada.
    // -----------------------------------------------------------------
    const bucket = new s3.Bucket(this, 'Imagenes', {
      bucketName: `ofrenda-imagenes-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // La URL firmada lleva la autorizacion; el CORS solo deja pasar el PUT.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    })

    // -----------------------------------------------------------------
    // Las tres Lambdas: el codigo de lambda/ tal cual, sin build.
    // -----------------------------------------------------------------
    const comunes = {
      runtime: lambda.Runtime.NODEJS_24_X,
      code: lambda.Code.fromAsset('lambda'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
    }

    const listar = new lambda.Function(this, 'Listar', {
      ...comunes,
      handler: 'listar.handler',
      environment: { TABLA: tabla.tableName },
    })
    tabla.grantReadData(listar)

    const agregar = new lambda.Function(this, 'Agregar', {
      ...comunes,
      handler: 'agregar.handler',
      environment: { TABLA: tabla.tableName },
    })
    tabla.grantReadWriteData(agregar)

    const subir = new lambda.Function(this, 'Subir', {
      ...comunes,
      handler: 'subir.handler',
      environment: { BUCKET: bucket.bucketName },
    })
    bucket.grantPut(subir)
    bucket.grantRead(subir)

    // -----------------------------------------------------------------
    // La REST API: cuatro rutas, stage v1, CORS para el navegador.
    // -----------------------------------------------------------------
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'ofrenda',
      deployOptions: { stageName: 'v1' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST'],
        allowHeaders: ['Content-Type'],
      },
    })

    const elements = api.root.addResource('elements')
    elements.addMethod('GET', new apigateway.LambdaIntegration(listar))
    elements.addMethod('POST', new apigateway.LambdaIntegration(agregar))

    const integracionSubir = new apigateway.LambdaIntegration(subir)
    const uploads = api.root.addResource('uploads')
    uploads.addMethod('POST', integracionSubir)
    // {proxy+} porque la imageKey lleva una "/" (<altarId>/<uuid>.jpeg).
    uploads.addResource('{proxy+}').addMethod('GET', integracionSubir)

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Ponla en Amplify como VITE_API_URL',
    })
  }
}
