import type {
  ClientConfig,
  QueryParams,
  HealthResponse,
  SystemResponse,
  VisitorsResponse,
  ChatHistoryResponse,
  ChatHistoryParams,
  ChatAnalyticsResponse,
  NotesListResponse,
  NoteDocumentWithContent,
  NotesListParams,
  NotesSearchParams,
  Tag,
  Category,
  VisitorAnalyticsResponse,
  VisitorAnalyticsSummaryResponse,
  AnalyticsParams,
  EventsResponse,
  EventsParams,
  W2MEventResponse,
  W2MCreateEventParams,
  W2MSetAvailabilityParams,
  ChatSubscriptionCallbacks,
  VisitorSubscriptionCallbacks,
  Subscription,
  ChatMessage,
  Visitor,
} from './types';

interface FetchOptions {
  params?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: string;
  body?: unknown;
}

const DEFAULT_TIMEOUT = 30000;

export class Client {
  private readonly baseUrl: string;
  private readonly wsBaseUrl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;

  constructor(config: ClientConfig | string) {
    if (typeof config === 'string') {
      this.baseUrl = config.replace(/\/$/, '');
      this.wsBaseUrl = this.baseUrl.replace(/^http/, 'ws');
      this.timeout = DEFAULT_TIMEOUT;
      this.headers = {};
    } else {
      this.baseUrl = config.baseUrl.replace(/\/$/, '');
      this.wsBaseUrl = config.wsBaseUrl || this.baseUrl.replace(/^http/, 'ws');
      this.timeout = config.timeout || DEFAULT_TIMEOUT;
      this.headers = config.headers || {};
    }
  }

  private async fetch<T>(
    endpoint: string,
    options: FetchOptions = {}
  ): Promise<T> {
    const { params, headers, signal, method = 'GET', body } = options;

    let url = `${this.baseUrl}${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal || controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`HTTP ${response.status}: ${error}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ===========================================================================
  // Health & System
  // ===========================================================================

  async health(): Promise<HealthResponse> {
    return this.fetch<HealthResponse>('/health');
  }

  async system(): Promise<SystemResponse> {
    return this.fetch<SystemResponse>('/system');
  }

  // ===========================================================================
  // Visitors
  // ===========================================================================

  readonly visitors = {
    list: (): Promise<VisitorsResponse> => {
      return this.fetch<VisitorsResponse>('/visitors');
    },

    analytics: (params?: AnalyticsParams): Promise<VisitorAnalyticsResponse> => {
      return this.fetch<VisitorAnalyticsResponse>('/visitor-analytics', { params: params as QueryParams });
    },

    analyticsSummary: (params?: Omit<AnalyticsParams, 'limit'>): Promise<VisitorAnalyticsSummaryResponse> => {
      return this.fetch<VisitorAnalyticsSummaryResponse>('/visitor-analytics/summary', { params: params as QueryParams });
    },

    subscribe: (callbacks: VisitorSubscriptionCallbacks = {}): Subscription => {
      return this.subscribeVisitors(callbacks);
    },
  };

  // ===========================================================================
  // Chat
  // ===========================================================================

  readonly chat = {
    history: (channel: string, params?: ChatHistoryParams): Promise<ChatHistoryResponse> => {
      return this.fetch<ChatHistoryResponse>(`/chat/${encodeURIComponent(channel)}/history`, { params: params as QueryParams });
    },

    analytics: (channel: string): Promise<ChatAnalyticsResponse> => {
      return this.fetch<ChatAnalyticsResponse>(`/chat/${encodeURIComponent(channel)}/analytics`);
    },

    subscribe: (channel: string, callbacks: ChatSubscriptionCallbacks = {}): Subscription => {
      return this.subscribeChat(channel, callbacks);
    },
  };

  // ===========================================================================
  // Notes
  // ===========================================================================

  readonly notes = {
    list: (params?: NotesListParams): Promise<NotesListResponse> => {
      return this.fetch<NotesListResponse>('/notes', { params: params as QueryParams });
    },

    get: (id: number): Promise<{ document: NoteDocumentWithContent }> => {
      return this.fetch<{ document: NoteDocumentWithContent }>(`/notes/${id}`);
    },

    search: (params: NotesSearchParams): Promise<NotesListResponse> => {
      return this.fetch<NotesListResponse>('/notes/search', { params: params as QueryParams });
    },

    tags: (): Promise<{ tags: Tag[] }> => {
      return this.fetch<{ tags: Tag[] }>('/notes/tags');
    },

    categories: (): Promise<{ categories: Category[] }> => {
      return this.fetch<{ categories: Category[] }>('/notes/categories');
    },

    byCategory: (category: string, params?: Omit<NotesListParams, 'category'>): Promise<NotesListResponse> => {
      return this.fetch<NotesListResponse>(`/notes/category/${encodeURIComponent(category)}`, { params: params as QueryParams });
    },

    byTag: (tag: string, params?: Omit<NotesListParams, 'tag'>): Promise<NotesListResponse> => {
      return this.fetch<NotesListResponse>(`/notes/tag/${encodeURIComponent(tag)}`, { params: params as QueryParams });
    },
  };

  // ===========================================================================
  // Events
  // ===========================================================================

  readonly events = {
    list: (params?: EventsParams): Promise<EventsResponse> => {
      return this.fetch<EventsResponse>('/events', { params: params as QueryParams });
    },
  };

  // ===========================================================================
  // When2Meet
  // ===========================================================================

  readonly when2meet = {
    getEvent: (id: string): Promise<W2MEventResponse> => {
      return this.fetch<W2MEventResponse>(`/w2m/${encodeURIComponent(id)}`);
    },

    createEvent: (params: W2MCreateEventParams): Promise<{ id: string }> => {
      return this.fetch<{ id: string }>('/w2m', {
        method: 'POST',
        body: params,
      });
    },

    setAvailability: (eventId: string, params: W2MSetAvailabilityParams): Promise<{ success: boolean }> => {
      return this.fetch<{ success: boolean }>(`/w2m/${encodeURIComponent(eventId)}/availability`, {
        method: 'POST',
        body: params,
      });
    },
  };

  // ===========================================================================
  // WebSocket Subscriptions
  // ===========================================================================

  private subscribeVisitors(callbacks: VisitorSubscriptionCallbacks): Subscription {
    const ws = new WebSocket(`${this.wsBaseUrl}/ws/visitors`);

    ws.onopen = () => callbacks.onOpen?.();
    ws.onclose = () => callbacks.onClose?.();
    ws.onerror = (e) => callbacks.onError?.(e);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'join' && callbacks.onJoin) {
          callbacks.onJoin(data.visitor as Visitor);
        } else if (data.type === 'leave' && callbacks.onLeave) {
          callbacks.onLeave(data.ip as string);
        } else {
          callbacks.onUpdate?.(data);
        }
      } catch {
        callbacks.onUpdate?.(event.data);
      }
    };

    return {
      close: () => ws.close(),
      send: (data) => ws.send(typeof data === 'string' ? data : JSON.stringify(data)),
    };
  }

  private subscribeChat(channel: string, callbacks: ChatSubscriptionCallbacks): Subscription {
    const ws = new WebSocket(`${this.wsBaseUrl}/ws/chat/${encodeURIComponent(channel)}`);

    ws.onopen = () => callbacks.onOpen?.();
    ws.onclose = () => callbacks.onClose?.();
    ws.onerror = (e) => callbacks.onError?.(e);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message' && callbacks.onMessage) {
          callbacks.onMessage(data as ChatMessage);
        } else if ((data.type === 'join' || data.type === 'leave') && callbacks.onPresence) {
          callbacks.onPresence(data);
        }
      } catch {
        // Non-JSON message
      }
    };

    return {
      close: () => ws.close(),
      send: (data) => ws.send(typeof data === 'string' ? data : JSON.stringify(data)),
    };
  }
}
