// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import core = require('@aws-cdk/core');
import inspector = require('@aws-cdk/aws-inspector');
import lambda = require('@aws-cdk/aws-lambda');
import iam = require('@aws-cdk/aws-iam');
import sns = require('@aws-cdk/aws-sns');
import sns_subs = require('@aws-cdk/aws-sns-subscriptions');
import * as cdk from '@aws-cdk/core';
import {App, Stack, StackProps} from '@aws-cdk/core';
import {InspectorSubscriber} from './inspector-subscriber-construct';
import * as fs from 'fs';
import inspector_rules_packages from '../config/inspector_rules_packages.json'
import {Effect} from "@aws-cdk/aws-iam";


export class InspectorAssessmentTemplateStack extends Stack {

    constructor(app: App, id: string, props: StackProps) {
        super(app, id, props);

        const centralAccountId = app.node.tryGetContext('centralAccountId')
        const topicArn = `arn:aws:sns:${cdk.Aws.REGION}:${centralAccountId}:${app.node.tryGetContext('inspectorSnsTopicName')}`
        const firehoseStreamName = app.node.tryGetContext('firehoseStreamName')
        const centralAccountRegion = app.node.tryGetContext('centralRegion')

        // Load Inspector rules mapping
        const inspector_rules_mapping = new core.CfnMapping(
            this,
            'Inspector Rule packages',
            {
                mapping: inspector_rules_packages
            }
        );

        // Create resource group
        const resource_group = new inspector.CfnResourceGroup(
            this,
            'CDK test resource group',
            {resourceGroupTags: [{key: 'Inspector', value: 'true'}]}
        );

        // Create assessment target
        const assessment_target = new inspector.CfnAssessmentTarget(
            this,
            'CDK test assessment target',
            {resourceGroupArn: resource_group.attrArn}
        );

        // Create assessment template
        const assessment_template = new inspector.CfnAssessmentTemplate(
            this,
            'CDK Inspector Assessment Template',
            {
                assessmentTargetArn: assessment_target.attrArn,
                durationInSeconds: 300,
                rulesPackageArns: [inspector_rules_mapping.findInMap(`${core.Aws.REGION}`, 'CVE'),
                    inspector_rules_mapping.findInMap(`${core.Aws.REGION}`, 'CIS'),
                    inspector_rules_mapping.findInMap(`${core.Aws.REGION}`, 'securityBestPractices'),
                    inspector_rules_mapping.findInMap(`${core.Aws.REGION}`, 'networkReachability')]
            }
        );

        // Subscribe assessment template
        const subscriber = new InspectorSubscriber(
            this,
            'Inspector SNS Subscriber', {
                Template: assessment_template.attrArn,
                Topic: topicArn,
            }
        );

        // Create lambda
        const reporter_lambda = new lambda.SingletonFunction(
            this, 'Singleton',
            {
                uuid: 'f7d4f730-4ee1-37e8-9c2d-f34ds01b54bc',
                code: new lambda.InlineCode(fs.readFileSync('lib/inspector-assessment-template/reporter_lambda/report.py',
                    {encoding: 'utf-8'})),
                handler: 'index.lambda_handler',
                timeout: core.Duration.seconds(300),
                runtime: lambda.Runtime.PYTHON_3_7,
                environment: {
                    'FIREHOSE_STREAM_NAME': firehoseStreamName,
                    'FIREHOSE_REGION': centralAccountRegion,
                    'FIREHOSE_ROLE_ARN': `arn:aws:iam::${centralAccountId}:role/central-audit-firehose-put-role-${centralAccountRegion}`
                }
            });

        // SNS permissions for lambda
        const servicePrincipal = new iam.ServicePrincipal('sns.amazonaws.com');
        const servicePrincipalWithConditions = servicePrincipal.withConditions({
            'ArnLike': {'aws:SourceArn': topicArn},
            'StringEquals': {'aws:SourceAccount': centralAccountId}
        })
        reporter_lambda.grantInvoke(servicePrincipalWithConditions)

        const topic = sns.Topic.fromTopicArn(this, 'inspector-topic', topicArn)
        topic.addSubscription(
            new sns_subs.LambdaSubscription(reporter_lambda)
        )

        // Inspector permissions for lambda
        reporter_lambda.addToRolePolicy(new iam.PolicyStatement({
            effect: Effect.ALLOW,
            actions:
                ['inspector:DescribeFindings',
                    'inspector:ListFindings'],
            resources: ['*']
        }));

        // Firehose permissions for lambda
        reporter_lambda.addToRolePolicy(new iam.PolicyStatement({
            actions:
                ['sts:AssumeRole'],
            resources: [`arn:aws:iam::${centralAccountId}:role/central-audit-firehose-put-role-${centralAccountRegion}`]
        }));

        // Stack outputs
        new core.CfnOutput(this, 'InspectorAssessmentTemplate', {value: assessment_template.attrArn});
    }
}