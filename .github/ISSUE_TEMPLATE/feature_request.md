name: Feature request
description: Suggest an idea for DsCode
title: "[Feature]: "
labels: [enhancement]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a feature. Describe what you'd like DsCode to do.
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What problem would this feature solve?
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      description: How should DsCode solve this?
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: Any workarounds you're using today?
