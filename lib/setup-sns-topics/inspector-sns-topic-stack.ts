// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import cdk = require('@aws-cdk/core');
import iam = require('@aws-cdk/aws-iam');
import kms = require('@aws-cdk/aws-kms');
import sns = require('@aws-cdk/aws-sns');
import {App, Stack, StackProps} from '@aws-cdk/core';
import inspector_sns_principals from '../config/inspector_sns_principals.json'


export class InspectorSnsTopicStack extends Stack {
    constructor(app: App, id: string, props: StackProps) {
        super(app, id, props);

        const topicName = app.node.tryGetContext('inspectorSnsTopicName')
        const workloadAccountId = app.node.tryGetContext('workloadAccountId')

        const sns_principals_mapping = new cdk.CfnMapping(this,
            'Inspector SNS Principals',
            {
                mapping: inspector_sns_principals
            }
        );

        // Create KMS Key
        const kmsKey = new kms.Key(this, 'SNSTopicKmsKey', {
            alias: 'key/snstopic-key',
            enableKeyRotation: true,
        });

        // Create Topic
        const topic = new sns.Topic(
            this, 'SNS Topic for Inspector Notifications', {
                topicName: topicName,
                masterKey: kmsKey
            }
        )

        // Add resource policy
        topic.addToResourcePolicy(
            new iam.PolicyStatement({
                    actions: ['sns:Publish'],
                    principals: ([`${cdk.Aws.REGION}`]).map(item => (new iam.ArnPrincipal(sns_principals_mapping.findInMap(item, 'ARN')))),
                    resources: [topic.topicArn]
                }
            )
        );

        kmsKey.addToResourcePolicy(
            new iam.PolicyStatement({
                    actions: ['kms:GenerateDataKey*',
                        'kms:Decrypt'],
                    principals: ([new iam.ServicePrincipal('inspector.amazonaws.com')]),
                    resources: ['*']
                }
            )
        );

        // Allow cross-account sns:Subscribe
        topic.addToResourcePolicy(
            new iam.PolicyStatement({
                    actions: ['SNS:Subscribe'],
                    principals: [new iam.AccountPrincipal(workloadAccountId)],
                    resources: [topic.topicArn]
                }
            )
        );

        // Stack Outputs
        new cdk.CfnOutput(this, 'Cfn-SNSTopicKmsKeyArn', {value: kmsKey.keyArn});
        new cdk.CfnOutput(this, 'Cfn-SNSTopicArn', {value: topic.topicArn});
    }
}