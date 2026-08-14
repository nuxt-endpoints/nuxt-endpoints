import { describe, expect, it } from 'vitest'
import { isStatusResponse, respond } from '../src/runtime'

describe('respond', () => {
  it('creates a status response marker', () => {
    const response = respond(404, { message: 'Not found' }, { headers: { 'x-test': '1' } })

    expect(isStatusResponse(response)).toBe(true)
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ message: 'Not found' })
    expect(response.headers).toEqual({ 'x-test': '1' })
  })

  it('does not treat plain objects as status response markers', () => {
    expect(isStatusResponse({ status: 404, body: { message: 'Not found' } })).toBe(false)
  })
})
