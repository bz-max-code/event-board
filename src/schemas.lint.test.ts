import { describe, expect, it } from 'vitest'
import { lintSchemas } from 'deepspace/worker'
import { schemas } from './schemas'

describe('schemas', () => {
  it('pass the SDK schema lint with no warnings', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })
})
