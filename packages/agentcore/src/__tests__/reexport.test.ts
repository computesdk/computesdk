import { describe, expect, it } from 'vitest'
import * as awsAgentcore from '@computesdk/aws/agentcore'
import * as agentcorePackage from '../index'

describe('@computesdk/agentcore (deprecated)', () => {
  it('re-exports agentcore from @computesdk/aws/agentcore', () => {
    expect(agentcorePackage.agentcore).toBe(awsAgentcore.agentcore)
  })
})
