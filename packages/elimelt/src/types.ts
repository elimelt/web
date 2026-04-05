// ============================================================================
// Core Types
// ============================================================================

export interface ClientConfig {
  baseUrl: string;
  wsBaseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  params?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

// ============================================================================
// Health & System
// ============================================================================

export interface HealthResponse {
  status: string;
  redis: string;
}

export interface SystemResponse {
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  redis: {
    connected: boolean;
    poolStats?: Record<string, unknown>;
  };
}

// ============================================================================
// Visitors
// ============================================================================

export interface Location {
  country: string;
  city: string;
  lat?: number | null;
  lon?: number | null;
}

export interface Visitor {
  ip: string;
  location: Location;
  connected_at: string;
}

export interface VisitRecord {
  ip: string;
  location: Location;
  timestamp: string;
}

export interface VisitorsResponse {
  active_count: number;
  active_visitors: Visitor[];
  recent_visits: VisitRecord[];
}

export interface VisitorJoinEvent {
  type: 'join';
  visitor: Visitor;
  timestamp: string;
}

export interface VisitorLeaveEvent {
  type: 'leave';
  ip: string;
  timestamp: string;
}

export type VisitorEvent = VisitorJoinEvent | VisitorLeaveEvent;

// ============================================================================
// Chat
// ============================================================================

export interface ChatMessage {
  type: string;
  channel: string;
  sender: string;
  text: string;
  timestamp: string;
  id?: string | null;
  reply_to?: string | null;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
  next_before?: string | null;
}

export interface ChatAnalyticsResponse {
  messages: number;
  senders: number;
}

export interface ChatHistoryParams {
  limit?: number;
  before?: string;
  [key: string]: string | number | boolean | undefined;
}

// ============================================================================
// Notes
// ============================================================================

export interface NoteDocument {
  id: number;
  file_path: string;
  title: string;
  category?: string | null;
  description?: string | null;
  last_modified?: string | null;
  git_commit_sha?: string | null;
  tags: string[];
}

export interface NoteDocumentWithContent extends NoteDocument {
  content?: string | null;
}

export interface NotesListResponse {
  documents: NoteDocument[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface NotesByCategoryResponse {
  category: string;
  documents: NoteDocument[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface NotesByTagResponse {
  tag: string;
  documents: NoteDocument[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface Tag {
  id: number;
  name: string;
  document_count: number;
}

export interface Category {
  id: number;
  name: string;
  document_count: number;
}

export interface NotesListParams {
  limit?: number;
  offset?: number;
  category?: string;
  tag?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface NotesSearchParams {
  q: string;
  limit?: number;
  offset?: number;
  use_semantic?: boolean;
  [key: string]: string | number | boolean | undefined;
}

// ============================================================================
// Analytics
// ============================================================================

export interface ClickEvent {
  timestamp: string;
  event: Record<string, unknown>;
}

export interface ClickEventsResponse {
  events: ClickEvent[];
  count: number;
  filters?: {
    start_date?: string | null;
    end_date?: string | null;
    page_path?: string | null;
    limit: number;
  } | null;
  error?: string | null;
}

export interface VisitorStats {
  visitor_ip: string;
  computed_at: string;
  period_start: string;
  period_end: string;
  total_visits: number;
  total_time_seconds: number;
  avg_session_duration_seconds: number;
  is_recurring: boolean;
  first_visit_at?: string | null;
  last_visit_at?: string | null;
  visit_frequency_per_day?: number | null;
  location_country?: string | null;
  location_city?: string | null;
}

export interface VisitorAnalyticsResponse {
  visitors: VisitorStats[];
  count: number;
  filters: {
    visitor_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    segment?: string | null;
    limit: number;
  };
}

export interface VisitorAnalyticsSummary {
  unique_visitors: number;
  total_visits: number;
  avg_session_duration_seconds: number;
  total_time_spent_seconds: number;
  recurring_visitors: number;
  avg_visit_frequency_per_day: number;
}

export interface VisitorAnalyticsSummaryResponse {
  summary: VisitorAnalyticsSummary;
  filters: {
    start_date?: string | null;
    end_date?: string | null;
  };
}

export interface AnalyticsParams {
  start_date?: string;
  end_date?: string;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

// ============================================================================
// Events
// ============================================================================

export interface ApiEvent {
  id: number;
  topic: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface EventsResponse {
  events: ApiEvent[];
  count: number;
  next_before?: string | null;
}

export interface EventsParams {
  topic?: string;
  type?: string;
  limit?: number;
  before?: string;
  [key: string]: string | number | boolean | undefined;
}

// ============================================================================
// When2Meet
// ============================================================================

export interface W2MEvent {
  id: string;
  name: string;
  description?: string | null;
  dates: string[];
  time_slots: string[];
  created_at: string;
  creator_name?: string | null;
}

export interface W2MAvailability {
  participant_name: string;
  available_slots: string[];
  created_at: string;
  updated_at: string;
}

export interface W2MEventResponse {
  event: W2MEvent;
  availabilities: W2MAvailability[];
  summary: Record<string, number>;
}

export interface W2MCreateEventParams {
  name: string;
  description?: string;
  dates: string[];
  time_slots: string[];
  creator_name?: string;
}

export interface W2MSetAvailabilityParams {
  participant_name: string;
  available_slots: string[];
  password?: string;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export interface WebSocketCallbacks<T> {
  onMessage?: (data: T) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export interface ChatSubscriptionCallbacks {
  onMessage?: (message: ChatMessage) => void;
  onPresence?: (event: VisitorEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export interface VisitorSubscriptionCallbacks {
  onJoin?: (visitor: Visitor) => void;
  onLeave?: (ip: string) => void;
  onUpdate?: (data: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export interface Subscription {
  close: () => void;
  send: (data: unknown) => void;
}
