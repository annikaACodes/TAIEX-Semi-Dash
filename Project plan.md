# Project Roadmap Draft

## Purpose

While Sebastian is working through the Phase 1 source/disclosure research in:

`docs/PHASE_1_DISCLOSURE_SPEC.md`

it would be helpful to also build a broader project roadmap from the senior instructions.

The goal of this file is to turn the overall project prompt into a clear plan of action that we can both use to stay organized.

This does not need to be perfect on the first pass. It can start as a draft and improve as we learn more.

---

## Suggested Focus

This document should answer the bigger-picture project questions:

1. What are we building?
2. Why does it matter?
3. What are the required phases?
4. What does each phase need to deliver?
5. What are the biggest risks or unknowns?
6. What should we work on next?

---

## 1. Project Purpose

Questions to answer:

- What is this tool supposed to do?
- Why does Taiwan monthly sales data matter?
- Why is this useful for semiconductor / AI supply-chain research?
- How does this connect to EPS revisions and earnings-preview work?

---

## 2. Scope

Questions to answer:

- What is the starting universe?
- Are we starting with TAIEX constituents?
- How should we think about semiconductor and semi-adjacent companies?
- Should TPEx / OTC names be included now or treated as a later extension?
- How much history is required?
- What level of automation is required?

---

## 3. Phase-by-Phase Plan

The senior prompt breaks the project into several phases. This section should turn those phases into a practical plan.

### Phase 1 — Disclosure Discovery

Questions to answer:

- What needs to be researched before scraping?
- What are the main deliverables?
- What questions need to be answered?
- What would count as Phase 1 being complete?

### Phase 2 — Capture and Storage

Questions to answer:

- What data needs to be captured?
- What fields need to be stored?
- What database structure might be needed?
- What does the quarterly reconciliation QC need to prove?
- What would count as Phase 2 being complete?

### Phase 3 — AI Classification

Questions to answer:

- What is the goal of classification?
- What subsectors should the model consider?
- Should companies be single-label or multi-label?
- How should human audit work?
- What would count as Phase 3 being complete?

### Phase 4 — Release Date Prediction and Auto-Update

Questions to answer:

- What does the system need to predict?
- How should it handle early reporters?
- How should it handle late reporters?
- What logs or alerts are needed?
- What would count as Phase 4 being complete?

### Phase 5 — Dashboard

Questions to answer:

- What minimum dashboard features are required?
- What should the PM be able to answer quickly?
- What exports are needed?
- What would make the dashboard impressive beyond the minimum?

---

## 4. Stretch Goals

Summarize the stretch goals from the senior prompt.

For each stretch goal, we can note:

- What it is
- Why it matters
- Whether it seems near-term, later, or optional

Stretch goals to cover:

- Alerting when a company or subsector inflects meaningfully
- Linking monthly trends to each company’s next earnings date
- Flagging names tracking ahead of or behind consensus revenue
- NT$ / USD toggle
- Seasonality-adjusted measures

---

## 5. Success Criteria

Turn the senior success criteria into a checklist.

Include:

- Coverage target
- Accuracy target
- History target
- Classification audit target
- Usability target

---

## 6. Risks and Open Questions

List risks and questions we should raise before building too much.

Examples:

- Official data source terms of use
- Rate limits
- Correct revenue basis
- Restatements
- TAIEX constituent source
- TPEx inclusion
- Quarterly revenue source
- Consensus data availability
- AI classification accuracy
- Dashboard users and review process

---

## 7. Proposed Near-Term To-Do List

A practical checklist for the next 1–2 weeks could look like this:

```text
Task | Owner | Priority | Status | Notes