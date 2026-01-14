/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {isUtf8} from 'node:buffer';

import type {HTTPRequest, HTTPResponse} from '../third_party/index.js';

const BODY_CONTEXT_SIZE_LIMIT = 10000;
const MAX_URL_LENGTH = 150;

function truncateUrl(url: string): string {
  if (url.length <= MAX_URL_LENGTH) {
    return url;
  }
  // Truncate in the middle to preserve both scheme and path
  const prefix = url.substring(0, Math.floor(MAX_URL_LENGTH * 0.6));
  const suffix = url.substring(url.length - Math.floor(MAX_URL_LENGTH * 0.4));
  return prefix + '...' + suffix;
}

export function getShortDescriptionForRequest(
  request: HTTPRequest,
  id: number,
  selectedInDevToolsUI = false,
): string {
  const truncatedUrl = truncateUrl(request.url());
  return `reqid=${id} ${request.method()} ${truncatedUrl} ${getStatusFromRequest(request)}${selectedInDevToolsUI ? ` [selected in the DevTools Network panel]` : ''}`;
}

export function getStatusFromRequest(request: HTTPRequest): string {
  const httpResponse = request.response();
  const failure = request.failure();
  let status: string;
  if (httpResponse) {
    const responseStatus = httpResponse.status();
    status =
      responseStatus >= 200 && responseStatus <= 299
        ? `[success - ${responseStatus}]`
        : `[failed - ${responseStatus}]`;
  } else if (failure) {
    status = `[failed - ${failure.errorText}]`;
  } else {
    status = '[pending]';
  }
  return status;
}

export function getFormattedHeaderValue(
  headers: Record<string, string>,
): string[] {
  const response: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    response.push(`- ${name}:${value}`);
  }
  return response;
}

export async function getFormattedResponseBody(
  httpResponse: HTTPResponse,
  sizeLimit = BODY_CONTEXT_SIZE_LIMIT,
): Promise<string | undefined> {
  try {
    const responseBuffer = await httpResponse.buffer();

    if (isUtf8(responseBuffer)) {
      const responseAsTest = responseBuffer.toString('utf-8');

      if (responseAsTest.length === 0) {
        return `<empty response>`;
      }

      return `${getSizeLimitedString(responseAsTest, sizeLimit)}`;
    }

    return `<binary data>`;
  } catch {
    return `<not available anymore>`;
  }
}

export async function getFormattedRequestBody(
  httpRequest: HTTPRequest,
  sizeLimit: number = BODY_CONTEXT_SIZE_LIMIT,
): Promise<string | undefined> {
  if (httpRequest.hasPostData()) {
    const data = httpRequest.postData();

    if (data) {
      return `${getSizeLimitedString(data, sizeLimit)}`;
    }

    try {
      const fetchData = await httpRequest.fetchPostData();

      if (fetchData) {
        return `${getSizeLimitedString(fetchData, sizeLimit)}`;
      }
    } catch {
      return `<not available anymore>`;
    }
  }

  return;
}

function getSizeLimitedString(text: string, sizeLimit: number) {
  if (text.length > sizeLimit) {
    return `${text.substring(0, sizeLimit) + '... <truncated>'}`;
  }

  return `${text}`;
}
