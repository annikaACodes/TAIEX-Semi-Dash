# Phase 1 — Disclosure Discovery Spec

## Purpose

This document explains how Taiwan-listed companies disclose monthly sales / operating revenue, what figure the dashboard should capture, how the data should be stored, and how edge cases such as restatements should be handled.

This phase must be completed before building the ingestion pipeline.

---

## Key Questions

1. When are Taiwan monthly sales officially disclosed?
2. What is the official source?
3. What is the disclosure deadline?
4. What format is the data available in?
5. What exact revenue figure should be captured?
6. Can companies publish more than one revenue basis?
7. How should restatements be detected?
8. How should restatements be stored?
9. How can monthly sales be reconciled to quarterly revenue?
10. What edge cases should the system handle?

---

## Official Sources to Research

Potential sources to validate:

- Taiwan MOPS
- TWSE open data
- Taiwan Government Open Data Platform
- Company monthly revenue announcements
- Company quarterly financial statements

For each source, document:

- URL
- Data owner / provider
- Update frequency
- Format
- Terms of use
- Whether it is suitable for automated collection

---

## Revenue Basis Decision

The system must explicitly define which revenue figure it captures.

Important issue:

Companies may report more than one revenue basis, such as parent-only revenue, consolidated revenue, cumulative revenue, or revised figures.

The dashboard should capture the figure that best reconciles to official quarterly revenue and is most relevant for EPS-revision analysis.

Decision to be finalized:

```text
Revenue basis captured: TBD
Reason: TBD
Alternative figures excluded: TBD
