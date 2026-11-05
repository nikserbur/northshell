import type { HttpRequestSpec } from './httpRequest'

/** A request kept in a collection. Without `sessionId` it is shared by every HTTP environment. */
export interface SavedRequest {
  id: string
  name: string
  /** Collection or folder it is listed under; '' for the top level. */
  folder: string
  sessionId?: string
  spec: HttpRequestSpec
  updatedAt: number
}

export interface SavedRequestInput {
  id?: string
  name: string
  folder: string
  sessionId?: string
  spec: HttpRequestSpec
}

export interface HttpHistoryItem {
  id: string
  spec: HttpRequestSpec
  status: number
  timeMs: number
  at: number
}

/** Collections, variables and history of all HTTP environments. */
export interface HttpWorkspace {
  requests: SavedRequest[]
  /** Variables per environment (session id). */
  vars: Record<string, Record<string, string>>
  /** Recent requests per environment, newest first. */
  history: Record<string, HttpHistoryItem[]>
}

/** One cookie of an environment's jar. */
export interface CookieEntry {
  domain: string
  path: string
  name: string
  value: string
  secure: boolean
  /** Seconds since 1970; 0 for a session cookie. */
  expires: number
}

/** What a collection file holds, before it goes into the workspace. */
export interface ImportedCollection {
  name: string
  requests: { name: string; folder: string; spec: HttpRequestSpec }[]
  variables: Record<string, string>
}

export function emptyWorkspace(): HttpWorkspace {
  return { requests: [], vars: {}, history: {} }
}
