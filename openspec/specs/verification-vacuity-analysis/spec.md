# verification-vacuity-analysis Specification

## Purpose
Makes the "verification machinery that reports success while measuring nothing" failure class legible as a standing, citable artifact — verified instances, a tested shared signature, and a detection rule whose limits are stated — so the next instance is recognisable rather than rediscovered.

## Requirements

### Requirement: A tracked analysis artifact enumerating verified instances

The project SHALL carry a tracked analysis artifact documenting the class. Every instance it cites SHALL record the evidence by which it was verified, and SHALL be marked as verified, partially verified, or unreproducible. The artifact SHALL NOT present an unreproducible historical figure as a verified measurement.

Where an instance's originally-reported framing is found to be wrong, the artifact SHALL state the correction rather than repeating the original claim.

#### Scenario: Each cited instance carries its verifying evidence
- **WHEN** the artifact cites an instance of the class
- **THEN** it states how that instance was verified, or marks it explicitly as unreproducible

#### Scenario: A corrected framing is stated as a correction
- **WHEN** an instance's original description is found to misdescribe the defect
- **THEN** the artifact records the correction and the evidence for it, rather than restating the original framing

### Requirement: The candidate signature is tested, not adopted

The artifact SHALL evaluate the proposed decomposition of the class against the verified instances and report the result, including whether the shapes are disjoint, whether any shape requires restatement, and whether any instance resists all proposed shapes.

#### Scenario: An instance resisting every proposed shape is reported
- **WHEN** a verified instance fits none of the proposed shapes
- **THEN** the artifact says so and proposes the additional shape required, rather than forcing the instance into an existing one

#### Scenario: Overlap between shapes is disclosed
- **WHEN** an instance exhibits more than one shape
- **THEN** the artifact states that the decomposition is not a partition

### Requirement: The detection rule states its own coverage limits

The artifact SHALL state a detection rule and SHALL name explicitly which verified instances that rule would and would **not** have caught. It SHALL NOT claim coverage it does not have.

#### Scenario: Non-coverage is enumerated, not summarised
- **WHEN** the detection rule is stated
- **THEN** the instances it would fail to catch are listed individually with the reason each escapes it

#### Scenario: Coverage is quantified against the verified set
- **WHEN** the artifact quantifies the rule's reach
- **THEN** the figure is expressed against the enumerated verified instances rather than asserted in general terms

### Requirement: Every computed figure carries a control

Any count or rate in the artifact SHALL be accompanied by a control demonstrating the measurement can produce a different result, and SHALL distinguish what was measured from what was inferred.

#### Scenario: A count is accompanied by a discriminating control
- **WHEN** the artifact reports a count derived from searching the corpus
- **THEN** it also reports a control establishing that the search can return a different number

#### Scenario: Mention counts are not presented as instance counts
- **WHEN** the artifact reports how often the class is referenced in the corpus
- **THEN** it states that these are mention counts, and that authorship counts cannot measure automated detection

### Requirement: The artifact recommends rather than implements

The artifact SHALL confine itself to analysis and recommendations. Each concrete remediation it proposes SHALL be identified as separate follow-up work rather than applied within it.

#### Scenario: A proposed remediation is scoped out, not applied
- **WHEN** the artifact identifies a concrete fix
- **THEN** it records it as a recommendation for separate follow-up work
