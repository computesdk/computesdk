---
description: AgentVM billable dedicated virtual machines with asynchronous commands through the AgentVM guest agent.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# AgentVM

`@computesdk/agentvm` provisions **billable dedicated managed machines**, not the pooled gVisor preview service. Install `@computesdk/agentvm` and set `AGENTVM_API_KEY`. Creation requires `allowBillableCreate: true` and a real plan ID, image ID, SSH public key, provider, region and bounded runtime from the authenticated AgentVM catalog.

An explicit `maxRuntimeSeconds` (at least 300) is mandatory. Machine creation may return before the guest operation agent is ready; a paid end-to-end lifecycle check is still required.

For usage and limitations, see the provider [README](https://github.com/computesdk/computesdk/tree/main/packages/agentvm). Destroy machines when finished; creation and running resources incur charges.
