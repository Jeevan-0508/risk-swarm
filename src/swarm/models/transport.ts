export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
  /** Internal runtime metadata; never serialized into the provider body. */
  readonly request_id?: string;
  readonly budget_category?: 'ROUND1_ANALYSIS' | 'CHALLENGE_GENERATION' | 'CHALLENGE_RESPONSE' | 'ZEUS_SYNTHESIS' | 'UNCLASSIFIED';
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export class FetchTransport implements HttpTransport {
  async request(request: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: request.signal });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { if (/^(retry-after|content-type)$/i.test(key)) headers[key] = value; });
    return { status: response.status, headers: Object.freeze(headers), body: await response.text() };
  }
}

export class MockTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly handler: (request: HttpRequest) => Promise<HttpResponse> | HttpResponse) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(Object.freeze({ ...request, headers: request.headers ? Object.freeze({ ...request.headers }) : undefined }));
    return this.handler(request);
  }
}
