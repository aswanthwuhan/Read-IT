/// <reference lib="webworker" />
import { validateZipBytes, type ZipValidationReply, type ZipValidationRequest } from './zipValidate';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ZipValidationRequest>) => {
  const bytes = event.data.bytes;
  let reply: ZipValidationReply;
  try {
    validateZipBytes(bytes);
    reply = { type: 'valid', bytes };
  } catch (error) {
    reply = {
      type: 'invalid',
      bytes,
      message: error instanceof Error ? error.message : 'This book has an invalid or unsupported ZIP archive.',
    };
  }

  // Return the transferred archive on both paths. The caller needs the same
  // buffer for mammoth after a successful check, and should not lose it merely
  // because validation failed.
  scope.postMessage(reply, [bytes]);
  scope.close();
};
