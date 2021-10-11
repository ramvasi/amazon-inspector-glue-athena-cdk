# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import os
import json
import logging

# Initialize Logger
LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

def lambda_handler(event, context):
    LOGGER.info('event: {}'.format(event))

    try:
        sns_msg = json.loads(event['Records'][0]['Sns']['Message'])
        # Process SNS Notification
        inspector_client = boto3.client('inspector')
        if sns_msg['event'] == 'FINDING_REPORTED':
            finding_arn = sns_msg['finding']
            finding_data = inspector_client.describe_findings(
                findingArns=[
                    finding_arn
                ],
                locale='EN_US'
            )
            LOGGER.info('finding_data: {}'.format(finding_data))
            # Get cross-account creds
            sts_connection = boto3.client('sts')
            acct_b = sts_connection.assume_role(
                RoleArn=os.environ['FIREHOSE_ROLE_ARN'],
                RoleSessionName='cross_acct_lambda'
            )
            ACCESS_KEY = acct_b['Credentials']['AccessKeyId']
            SECRET_KEY = acct_b['Credentials']['SecretAccessKey']
            SESSION_TOKEN = acct_b['Credentials']['SessionToken']
            # Firehose client
            firehose_client = boto3.client('firehose', region_name=os.environ['FIREHOSE_REGION'],
                                           aws_access_key_id=ACCESS_KEY,
                                           aws_secret_access_key=SECRET_KEY,
                                           aws_session_token=SESSION_TOKEN,
                                           )
            # Post findings to firehose
            for item in finding_data['findings']:
                flat_item = flatten_json(item)
                firehose_data_record = {
                    'Data': (json.dumps(flat_item, default=str) + '\n').encode(encoding='utf-8', errors='strict')}
                LOGGER.info('Record: {}'.format(firehose_data_record))
                resp = firehose_client.put_record(
                    DeliveryStreamName=os.environ['FIREHOSE_STREAM_NAME'],
                    Record=firehose_data_record
                )
    except Exception as e:
        # Print trace
        LOGGER.exception('Error while processing SNS Notification.')
        return str(e)

    return 'OK'


def flatten_json(y):
    out = {}

    def flatten(x, name=''):
        if type(x) is dict:
            for a in x:
                flatten(x[a], name + a + '.')
        elif type(x) is list:
            i = 0
            for a in x:
                flatten(a, name + str(i) + '.')
                i += 1
        else:
            out[name[:-1]] = x

    flatten(y)
    return out