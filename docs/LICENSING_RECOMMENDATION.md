# Licensing Recommendation for dscode

## Current status

dscode is currently licensed under the **MIT License**, inherited from the upstream project [lessweb/deepcode-cli](https://github.com/lessweb/deepcode-cli).

The MIT license of the upstream project MUST be preserved in the [NOTICE](../NOTICE) file and in the [LICENSE](../LICENSE) file. This is a legal requirement of the MIT license ("The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software").

## Objective

The project goal is to publish dscode as a **free, public, open-source repository** that:
- Allows external contributions via issues and pull requests
- Does not allow direct push to the main branch
- Is not intended to be sold commercially at this time

## License comparison

### Apache-2.0
- **Adoption**: Maximum corporate adoption. Used by Kubernetes, TensorFlow, React (Facebook changed from BSD+patents).
- **Permissions**: Permissive. Allows use, modification, distribution, sublicensing, and commercial use.
- **Patent clause**: Includes an explicit patent grant, protecting contributors and users from patent litigation.
- **Downsides**: Longer text; some organizations have policies avoiding it due to the patent termination clause.

### MIT
- **Adoption**: Maximum simplicity. The most popular open-source license by usage count.
- **Permissions**: Permissive. Allows almost anything as long as the copyright notice is preserved.
- **Patent clause**: None. No explicit patent grant or protection.
- **Downsides**: No patent protection; no defense against appropriation into closed-source products.

### AGPLv3
- **Adoption**: Lower corporate adoption due to copyleft requirements.
- **Permissions**: Strong copyleft. If you modify the code and run it as a network service, you must release your modifications.
- **Patent clause**: Includes patent grant.
- **Downsides**: Corporate legal teams often prohibit AGPL dependencies. This reduces adoption and contribution.

## Recommendation

**Keep MIT** for dscode.

Rationale:
1. **Upstream compatibility**: The upstream project (deepcode-cli) is MIT-licensed. Switching to a different license would create legal complexity and potential incompatibility.
2. **Simplicity**: MIT is the simplest license to understand and comply with. This maximizes contributions.
3. **Ecosystem fit**: The project is a CLI tool distributed via npm. MIT is the standard for npm packages.
4. **No immediate need for copyleft**: The project is not currently at risk of proprietary appropriation. If this becomes a concern later, the license can be reevaluated (though existing MIT-licensed code would remain MIT).
5. **Patent risk is low**: The project is a thin client that wraps LLM APIs. It does not implement novel algorithms with patent risk.

## What MUST be preserved

Regardless of the current or future license choice, the upstream MIT copyright notice MUST be retained:
- In the [LICENSE](../LICENSE) file
- In the [NOTICE](../NOTICE) file
- In any distributed copies of the software

## Re-evaluation triggers

Consider re-evaluating the license if:
- A major corporate sponsor requests a specific license
- The project implements novel, patentable functionality
- There is evidence of proprietary appropriation that harms the community
