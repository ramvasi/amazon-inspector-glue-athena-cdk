// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import cdk = require('@aws-cdk/core');
import s3 = require('@aws-cdk/aws-s3');
import iam = require('@aws-cdk/aws-iam');
import kdf = require('@aws-cdk/aws-kinesisfirehose');
import {Effect, Role, ServicePrincipal} from '@aws-cdk/aws-iam';
import {App, CfnResource, RemovalPolicy, Stack, StackProps} from '@aws-cdk/core';
import {BucketEncryption} from '@aws-cdk/aws-s3';
import * as logs from '@aws-cdk/aws-logs';
import {CfnCrawler} from "@aws-cdk/aws-glue";
import {ManagedPolicy, PolicyDocument} from "@aws-cdk/aws-iam";


export class FirehoseStack extends Stack {
    constructor(app: App, id: string, props: StackProps) {
        super(app, id, props);

        const firehoseStreamName = app.node.tryGetContext('firehoseStreamName')
        const workloadAccountId = app.node.tryGetContext('workloadAccountId')

        // Create S3 bucket
        const bucket = new s3.Bucket(this, 'FirehoseDeliveryBucket', {
            versioned: true,
            encryption: BucketEncryption.S3_MANAGED
        });

        // Create Firehose role
        const firehoseRole = new iam.Role(this, 'FirehoseRole', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com')
        });

        const s3Policy = (new iam.PolicyStatement({
            actions:
                ['s3:AbortMultipartUpload',
                    's3:GetBucketLocation',
                    's3:GetObject',
                    's3:ListBucket',
                    's3:PutObject',
                    's3:ListBucketMultipartUploads'],
            resources: [`arn:aws:s3:::${bucket.bucketName}`,
                `arn:aws:s3:::${bucket.bucketName}/*`]
        }));

        const logsPolicy = (new iam.PolicyStatement({
            actions:
                ['logs:GetLogEvents',
                    'logs:PutLogEvents',
                    'logs:CreateLogStream',
                    'logs:DescribeLogStreams',
                    'logs:PutRetentionPolicy',
                    'logs:CreateLogGroup',
                    'logs:CreateLogStream',
                    'logs:DescribeLogStreams',
                    'logs:PutRetentionPolicy',
                    'logs:CreateLogGroup'],
            resources: ['*']
        }));

        firehoseRole.addToPolicy(s3Policy)
        firehoseRole.addToPolicy(logsPolicy)

        // Create Firehose log group, log stream
        const logGroup = new logs.LogGroup(this, 'InspectorFindingsFirehoseGlueLogGroup');
        const logStream = new logs.LogStream(this, 'InspectorFindingsFirehoseGlueLogStream', {
            logStreamName: 'InspectorFirehoseGlueDeliveryStream',
            removalPolicy: RemovalPolicy.DESTROY,
            logGroup: logGroup
        })

        // Create Firehose stream
        const firehose = new kdf.CfnDeliveryStream(this, 'FirehoseDeliveryStream', {
            deliveryStreamName: firehoseStreamName,
            deliveryStreamType: 'DirectPut',
            extendedS3DestinationConfiguration: {
                bucketArn: bucket.bucketArn,
                bufferingHints: {
                    intervalInSeconds: 60,
                    sizeInMBs: 1
                },
                compressionFormat: 'UNCOMPRESSED',
                roleArn: firehoseRole.roleArn,
                prefix: 'inspector-findings/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/',
                errorOutputPrefix: 'myErrors/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/!{firehose:error-output-type}',
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: logGroup.logGroupName,
                    logStreamName: logStream.logStreamName,
                },
            }
        });

        // Create Glue Crawler role
        const inspectorFindingsGlueCrawlerRole = new Role(this, "InspectorFindingsGlueCrawlerRole", {
            assumedBy: new ServicePrincipal("glue.amazonaws.com"),
            description: "Role used by Glue",
            inlinePolicies: {
                "InspectorFindingsGlueCrawlerPolicy": PolicyDocument.fromJson({
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Action": [
                                "s3:GetObject",
                                "s3:PutObject"
                            ],
                            "Resource": [`${bucket.bucketArn}`,
                                `${bucket.bucketArn}/*`],
                        }
                    ],
                }),
            },
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole"),
            ],
        });

        // Create Glue Crawler
        new CfnCrawler(this, "InspectorFindingsCrawler", {
            name: "inspector-findings-crawler",
            role: inspectorFindingsGlueCrawlerRole.roleArn,
            targets: {
                s3Targets: [
                    {path: bucket.bucketName+'/inspector-findings'},
                ]
            },
            databaseName: "inspector",
            schemaChangePolicy: {
                deleteBehavior: 'DELETE_FROM_DATABASE'
            }
        });

        // Allow cross-account lambda to assume role
        const firehoseLambdaExecRole = new iam.Role(this, 'FirehoseLambdaExecRole', {
            assumedBy: new iam.AccountPrincipal(workloadAccountId),
            roleName: 'central-audit-firehose-put-role'+'-'+`${cdk.Aws.REGION}`
        });

        firehoseLambdaExecRole.addToPolicy(new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['firehose:PutRecord',
                'firehose:PutRecords'],
            resources: [firehose.attrArn]
        }))

    }
}