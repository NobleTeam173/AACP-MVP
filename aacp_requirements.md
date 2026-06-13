# AACP Requirements

## MVP Scope
- Build a pilot workforce intelligence and competency validation platform for a 50-participant aviation/aerospace cohort.
- Keep the solution minimally viable: mobile-first, responsive, accessible, and low complexity.
- Include youth career exploration, competency assessment, AI advisory guidance, workforce analytics, and matching recommendations.
- Avoid full AR/VR, blockchain credentials, or deep HRIS integration in the MVP.

## Regulatory compliance
- Align competencies and readiness assessments with Canadian Aviation Regulations (CARs) and Transport Canada training/licensing guidance where applicable.
- Map role families, roles, and competencies to regulatory references and capture them in the data model.
- Treat AI outputs as decision support; do not present AI guidance as authoritative regulatory advice.
- Flag regulatory-sensitive outputs and require human review before any compliance-sensitive action.
- Preserve auditability for regulatory-sensitive decisions, including rationale and source references.

## Privacy and data handling
- Design the pilot for PIPEDA-aligned data handling.
- Collect only the minimum personal information required for the cohort and pilot evaluation.
- Capture explicit consent for personal data processing and evidence review.
- Store consent records and support withdrawal or retention rules.
- Use role-based access control to limit data access by user role.
- Log data access and changes in audit records.
- Encrypt sensitive data at rest and in transit where possible.

## Privacy-by-design requirements
- Build privacy considerations into the architecture from the start.
- Prepare the system to minimize data sharing outside authorized roles.
- Use consent-aware workflows for youth participants.
- Limit dashboard and analytics outputs to aggregated or authorized views.
- Make privacy notice and consent status visible to users.

## MVP constraints
- Focus on a 50-participant pilot cohort only.
- Keep the platform simple and testable.
- Prioritize core entities and workflows first: users, cohorts, competencies, assessments, evidence, readiness, and matches.
- Add compliance, privacy, and audit capabilities as first-order concerns, not afterthoughts.
