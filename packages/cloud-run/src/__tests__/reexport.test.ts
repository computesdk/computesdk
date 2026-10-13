import { describe, expect, it } from 'vitest'
import * as gcpCloudRun from '@computesdk/gcp/cloud-run'
import * as cloudRunPackage from '../index'

describe('@computesdk/cloud-run (deprecated)', () => {
  it('re-exports cloudRun from @computesdk/gcp/cloud-run', () => {
    expect(cloudRunPackage.cloudRun).toBe(gcpCloudRun.cloudRun)
  })
})
