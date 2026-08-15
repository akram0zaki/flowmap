# Delivery Radar — Product Pack

This folder contains the product-definition artifacts created from the structured product interview.

Files:

1. **delivery-radar-PRD.md** — product vision, scope, user model, domain model, success criteria, MVP boundary.
2. **delivery-radar-UX-functional-spec.md** — visual language, interaction model, screens/lenses, functional UX behavior, accessibility.
3. **delivery-radar-technical-architecture.md** — recommended cross-platform architecture, data model, storage abstraction, sync/offline, security and technical spikes.
4. **delivery-radar-build-plan.md** — phased implementation plan, MVP cut, technical sequencing, validation plan.
5. **delivery-radar-implementation-plan.md** — gap analysis, decision gates, executable delivery phases, quality gates, and initial engineering backlog.

The current architectural preference is **React + TypeScript + Tauri**, with a local SQLite cache and a pluggable shared-storage provider. **SharePoint/M365 structured storage** is the preferred shared provider subject to ING technical-policy validation; a file-based provider remains a fallback.

The product intentionally excludes AI and direct enterprise-system integrations from MVP.
