# Contrail recorder — optional 24/7 VATSIM snapshot recorder for the time machine.
# Build from the repository root:   docker build -f Server/Dockerfile -t contrail-recorder .

# Runtime base, overridable (e.g. --build-arg RUNTIME_IMAGE=ubuntu:24.04 with libcurl4 + ca-certificates).
ARG RUNTIME_IMAGE=swift:6.2-slim

# ---- build ----
FROM swift:6.2 AS build
WORKDIR /src
COPY ContrailKit/Package.swift ./ContrailKit/
COPY ContrailKit/Sources ./ContrailKit/Sources
# The manifest declares the test target, so its folder must exist (tests are not built).
COPY ContrailKit/Tests ./ContrailKit/Tests
WORKDIR /src/ContrailKit
RUN swift build -c release --product contrail-recorder --static-swift-stdlib \
    && cp "$(swift build -c release --show-bin-path)/contrail-recorder" /usr/local/bin/contrail-recorder

# ---- runtime ----
FROM ${RUNTIME_IMAGE}
RUN useradd --system --uid 10001 --home-dir /data --no-create-home recorder \
    && mkdir -p /data && chown recorder /data
COPY --from=build /usr/local/bin/contrail-recorder /usr/local/bin/contrail-recorder
USER recorder
VOLUME ["/data"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["contrail-recorder", "--output", "/data"]
CMD ["--interval", "15", "--retention-days", "7"]
