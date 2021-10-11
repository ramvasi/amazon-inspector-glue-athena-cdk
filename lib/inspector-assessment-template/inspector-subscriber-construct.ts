// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import cdk = require('@aws-cdk/core');
import iam = require('@aws-cdk/aws-iam');
import lambda = require('@aws-cdk/aws-lambda');
import cfn = require('@aws-cdk/aws-cloudformation');
import fs = require('fs');
import {StackProps} from '@aws-cdk/core';

export interface InspectorSubscriberProps {
    readonly Template: string;
    readonly Topic: string
}

export class InspectorSubscriber extends cdk.Construct {
    public readonly response: string;

    constructor(scope: cdk.Construct, id: string, props: InspectorSubscriberProps) {
        super(scope, id);

        const subscriber_lambda = new lambda.SingletonFunction(
            this, 'Subscriber_Lambda',
            {
                uuid: 'q7l4f730-4ee1-11e8-9c2d-q34we01b54tg',
                code: new lambda.InlineCode(fs.readFileSync('lib/inspector-assessment-template/subscriber_lambda/template_subscriber.py',
                    {encoding: 'utf-8'})),
                handler: 'index.lambda_handler',
                timeout: cdk.Duration.seconds(300),
                runtime: lambda.Runtime.PYTHON_3_7
            });

        subscriber_lambda.addToRolePolicy(
            new iam.PolicyStatement({
                    actions: ['inspector:SubscribeToEvent'],
                    resources: ['*']
                }
            )
        )

        const resource = new cfn.CustomResource(
            this, 'Resource',
            {
                provider: cfn.CustomResourceProvider.lambda(subscriber_lambda),
                properties: props,
            }
        );
        this.response = resource.getAtt('Response').toString();
    }
}