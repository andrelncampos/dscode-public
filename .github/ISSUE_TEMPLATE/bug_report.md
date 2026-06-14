name: Bug report
description: Report a problem with DsCode
title: "[Bug]: "
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug. Please fill in the details below.
  - type: input
    id: version
    attributes:
      label: DsCode version
      description: Run `dscode --version` and paste the output.
      placeholder: dscode 1.0.15
    validations:
      required: true
  - type: input
    id: os
    attributes:
      label: Operating system
      placeholder: Windows 11, Ubuntu 24.04, macOS 15
    validations:
      required: true
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: Describe the problem. Include the exact command you ran and the full error message.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: What did you expect to happen?
  - type: input
    id: model
    attributes:
      label: AI model used
      placeholder: deepseek-v4-pro
