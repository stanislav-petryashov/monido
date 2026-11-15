# check=skip=InvalidDefaultArgInFrom
# The release image (docker.yml, job promote): the master image already built and smoke-tested for the tagged commit,
# by digest, with only the version it reports changed. No RUN step, so nothing runs under emulation: buildx picks each
# platform's manifest from the base's multi-arch index, and the filesystem layers stay the master image's, byte for byte.
# BASE has no default on purpose: without it the build fails ("base name should not be blank").
ARG BASE
FROM ${BASE}
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
