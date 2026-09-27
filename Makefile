PROVIDER ?= deepseek
MODEL ?= deepseek-flash
REASONING ?= medium
REPOSITORY_MAP ?= enabled
MAX_STEPS ?= 120
MAX_MODEL_CALLS ?= 80
MAX_MINUTES ?= 60
MAX_REPAIR_ATTEMPTS ?= 12
VERIFICATION_RESERVE_STEPS ?= 10
MAX_STAGNATION_INTERVENTIONS ?= 6
MAX_CONTEXT_CHARS ?= 64000

.PHONY: setup runner-image run caramel benchmark scorecard test test-docker contract rehearse-clean check

setup:
	bun install --frozen-lockfile

runner-image:
	docker build --file docker/runner.Dockerfile --tag dinner-runner:0.1.0 .

run:
	bun run src/cli.ts run $(ARGS)

caramel:
	@test -n "$(REPO)" || (echo "Usage: make caramel REPO=/path/to/repo ISSUE=https://github.com/owner/repo/issues/123"; exit 2)
	@test -n "$(ISSUE)" || (echo "Usage: make caramel REPO=/path/to/repo ISSUE=https://github.com/owner/repo/issues/123"; exit 2)
	bun run src/cli.ts run \
		--repo "$(REPO)" \
		--issue "$(ISSUE)" \
		--provider "$(PROVIDER)" \
		--model "$(MODEL)" \
		--reasoning-effort "$(REASONING)" \
		--repository-map "$(REPOSITORY_MAP)" \
		--max-steps "$(MAX_STEPS)" \
		--max-model-calls "$(MAX_MODEL_CALLS)" \
		--max-minutes "$(MAX_MINUTES)" \
		--max-repair-attempts "$(MAX_REPAIR_ATTEMPTS)" \
		--verification-reserve-steps "$(VERIFICATION_RESERVE_STEPS)" \
		--max-stagnation-interventions "$(MAX_STAGNATION_INTERVENTIONS)" \
		--max-context-chars "$(MAX_CONTEXT_CHARS)"

benchmark:
	bun run src/benchmark/cli.ts evaluate $(ARGS)

scorecard:
	bun run scorecard

test:
	bun test

test-docker:
	DINNER_DOCKER_INTEGRATION=1 bun test tests/docker-runner.integration.test.ts tests/benchmark-runner.integration.test.ts

contract:
	bun test tests/execution-contract.test.ts

rehearse-clean:
	bash scripts/rehearse-clean-install.sh

check:
	bun run check
