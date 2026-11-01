// Copyright Vespa.ai. Licensed under the terms of the Apache 2.0 license. See LICENSE in the project root.

#include "proto_telemetry_carrier.h"

#include <iomanip>
#include <iostream>
#include <sstream>

namespace vespa_opentelemetry {

ProtoTelemetryCarrier::ProtoTelemetryCarrier(const Map& map) noexcept : _map(map) {
    bool               first = true;
    std::ostringstream os;
    os << "trace_context = {";
    for (auto& entry : _map) {
        if (!first) {
            os << ", ";
        }
        first = false;
        os << std::quoted(entry.first) << " => " << std::quoted(entry.second);
    }
    os << "}";
    std::cerr << os.str() << std::endl;
}

ProtoTelemetryCarrier::~ProtoTelemetryCarrier() = default;

bool ProtoTelemetryCarrier::empty() const noexcept {
    return _map.empty();
}

opentelemetry::nostd::string_view ProtoTelemetryCarrier::Get(opentelemetry::nostd::string_view key) const noexcept {
    auto it = _map.find(std::string(key));
    if (it != _map.end()) {
        return opentelemetry::nostd::string_view(it->second);
    }
    return "";
}

void ProtoTelemetryCarrier::Set(opentelemetry::nostd::string_view, opentelemetry::nostd::string_view) noexcept {
}

} // namespace vespa_opentelemetry
