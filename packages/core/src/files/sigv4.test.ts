import { describe, expect, test } from 'bun:test';
import { presignUrl, sha256Hex, signRequest } from './sigv4.js';

// AWS Signature Version 4 test suite (https://docs.aws.amazon.com/general/latest/gr/signature-v4-test-suite.html)
const suite = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  date: new Date('2015-08-30T12:36:00Z'),
  payloadHash: sha256Hex(''),
};

describe('signRequest: AWS SigV4 test suite', () => {
  test('get-vanilla', () => {
    const headers = signRequest({ ...suite, method: 'GET', url: 'https://example.amazonaws.com/' });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
  });

  test('post-vanilla', () => {
    const headers = signRequest({ ...suite, method: 'POST', url: 'https://example.amazonaws.com/' });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b',
    );
  });

  test('get-vanilla-query-order-key-case', () => {
    const headers = signRequest({ ...suite, method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1' });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
    );
  });
});

// Amazon S3 documentation examples (Signature Calculations for the Authorization Header / Query String)
const s3 = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
  date: new Date('2013-05-24T00:00:00Z'),
};

describe('S3 examples', () => {
  test('GET Object with a Range header', () => {
    const headers = signRequest({
      ...s3,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: sha256Hex(''),
      includeContentSha256: true,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  test('presigned GET', () => {
    const url = presignUrl({ ...s3, method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', expiresIn: 86400 });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });
});
