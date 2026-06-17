/**
 * TankerMap — Main Application Controller
 */

(function () {
  "use strict";

  const DAILY_PORTS_URL =
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0/query?where=1%3D1&outFields=year,month,day,portname,country,portcalls_tanker,import_tanker,export_tanker,portid&outSR=4326&f=json";

  const PORTS_GEOMETRY_URL =
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/PortWatch_ports_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,country,lat,lon,vessel_count_tanker&returnGeometry=true&outSR=4326&f=json";

  const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const TILE_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const MARKER_COLOR = "#22d3ee";
  const MARKER_SELECTED_COLOR = "#f97316";
  const MARKER_MIN_RADIUS = 4;
  const MARKER_MAX_RADIUS = 18;

  let map;
  let portLayer;
  let selectedMarker = null;

  const ui = {
    portHeader: null,
    portName: null,
    portCountry: null,
    tankerTraffic: null,
    congestionRisk: null,
    supplyRole: null,
    analysisText: null,
    analysisBlock: null,
    analysisTimestamp: null,
  };

  function cacheDomElements() {
    ui.portHeader = document.getElementById("port-header");
    ui.portName = document.getElementById("selected-port-name");
    ui.portCountry = document.getElementById("selected-port-country");
    ui.tankerTraffic = document.getElementById("metric-tanker-traffic");
    ui.congestionRisk = document.getElementById("metric-congestion-risk");
    ui.supplyRole = document.getElementById("metric-supply-role");
    ui.analysisText = document.getElementById("analysis-text");
    ui.analysisBlock = document.getElementById("economic-analysis");
    ui.analysisTimestamp = document.getElementById("analysis-timestamp");
  }

  function initMap() {
    map = L.map("map", {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 12,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);

    portLayer = L.layerGroup().addTo(map);

    requestAnimationFrame(function () {
      map.invalidateSize();
    });
  }

  async function fetchArcGISPage(url, offset, pageSize) {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl =
      url +
      separator +
      "resultRecordCount=" +
      pageSize +
      "&resultOffset=" +
      offset;

    const response = await fetch(pageUrl);

    if (!response.ok) {
      throw new Error("HTTP " + response.status + ": " + response.statusText);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || "ArcGIS query failed");
    }

    return data;
  }

  async function fetchAllArcGISFeatures(url) {
    const features = [];
    const pageSize = 2000;
    let offset = 0;

    while (true) {
      const data = await fetchArcGISPage(url, offset, pageSize);
      features.push.apply(features, data.features || []);

      if (!data.exceededTransferLimit) {
        break;
      }

      offset += pageSize;
    }

    return features;
  }

  function aggregateDailyPortActivity(features) {
    const byPort = new Map();

    features.forEach(function (feature) {
      const attrs = feature.attributes || feature.properties || {};
      const portId = attrs.portid;

      if (!portId) {
        return;
      }

      const existing = byPort.get(portId) || {
        portid: portId,
        portname: attrs.portname,
        country: attrs.country,
        portcalls_tanker: 0,
      };

      existing.portcalls_tanker += Number(attrs.portcalls_tanker) || 0;
      byPort.set(portId, existing);
    });

    return byPort;
  }

  function getMarkerRadius(vesselCount, minCount, maxCount) {
    if (!vesselCount || vesselCount <= 0) {
      return MARKER_MIN_RADIUS;
    }

    if (maxCount <= minCount) {
      return MARKER_MAX_RADIUS;
    }

    const normalized =
      Math.sqrt(vesselCount - minCount) / Math.sqrt(maxCount - minCount);

    return MARKER_MIN_RADIUS + normalized * (MARKER_MAX_RADIUS - MARKER_MIN_RADIUS);
  }

  function generateEconomicInference(portData) {
    const count = portData.vessel_count_tanker;
    const name = portData.portname;
    const country = portData.country;

    if (count > 150) {
      return {
        supplyChainRole: "Global Chokepoint / Primary Energy Hub",
        congestionRisk: "High",
        riskClass: "text-red-400",
        roleClass: "text-amber-300",
        analysis:
          name +
          " operates as a critical global energy chokepoint with " +
          count.toLocaleString() +
          " observed tanker vessels. At this throughput density, even brief operational disruptions—whether from geopolitical conflict, extreme weather, or labor stoppages—can trigger immediate Brent crude price spikes as arbitrageurs reprice supply risk. " +
          country +
          "'s macroeconomic stability is tightly coupled to uninterrupted flows through this hub, making it a focal point for sovereign risk monitors and commodity hedge desks alike.",
      };
    }

    if (count >= 50 && count <= 150) {
      return {
        supplyChainRole: "Regional Distribution Node",
        congestionRisk: "Moderate",
        riskClass: "text-amber-400",
        roleClass: "text-sky-300",
        analysis:
          name +
          " functions as a regional distribution node handling " +
          count.toLocaleString() +
          " tanker movements, positioning it as a linchpin for " +
          country +
          "'s localized energy security. While not a systemic global chokepoint, congestion or regulatory delays here can ripple through adjacent refining corridors and elevate regional spot premiums. Policymakers should treat sustained throughput growth at this port as an early indicator of shifting trade lane dependencies.",
      };
    }

    return {
      supplyChainRole: "Secondary Feeder Port",
      congestionRisk: "Low",
      riskClass: "text-green-400",
      roleClass: "text-slate-300",
      analysis:
        name +
        " registers as a secondary feeder port with " +
        count.toLocaleString() +
        " tanker vessels, indicating a supportive rather than dominant role in " +
        country +
        "'s maritime energy network. Disruptions at this facility carry limited direct impact on global crude benchmarks, though they may affect niche product flows and coastal supply chains. This port represents a lower-priority node for systemic risk modeling but remains relevant for granular regional trade analysis.",
    };
  }

  function setMetricClasses(element, baseClasses, colorClass) {
    element.className = baseClasses + " " + colorClass;
  }

  function highlightMarker(marker) {
    if (selectedMarker) {
      selectedMarker.setStyle({
        fillColor: MARKER_COLOR,
        color: "#67e8f9",
        weight: 1.5,
        fillOpacity: 0.65,
      });
    }

    marker.setStyle({
      fillColor: MARKER_SELECTED_COLOR,
      color: "#fdba74",
      weight: 2.5,
      fillOpacity: 0.9,
    });

    selectedMarker = marker;
    marker.bringToFront();
    marker.openPopup();
  }

  function updateEconomicAnalysis(portData) {
    const inference = generateEconomicInference(portData);

    ui.portHeader.classList.remove("analysis-header--idle");
    ui.portHeader.classList.add("analysis-header--active");

    ui.portName.textContent = portData.portname;
    ui.portName.className = "text-lg font-semibold leading-snug text-white";

    ui.portCountry.textContent = portData.country;
    ui.portCountry.className =
      "mt-1 font-mono text-[11px] uppercase tracking-widest text-accent";

    ui.tankerTraffic.textContent = portData.vessel_count_tanker.toLocaleString();

    ui.congestionRisk.textContent = inference.congestionRisk;
    setMetricClasses(
      ui.congestionRisk,
      "mt-1 font-mono text-lg font-semibold",
      inference.riskClass
    );

    ui.supplyRole.textContent = inference.supplyChainRole;
    setMetricClasses(
      ui.supplyRole,
      "mt-1 text-sm font-medium leading-snug",
      inference.roleClass
    );

    ui.analysisText.textContent = inference.analysis;
    ui.analysisText.className = "analysis-text text-sm leading-relaxed text-slate-300";

    ui.analysisBlock.classList.add("analysis-block--updated");

    const now = new Date();
    ui.analysisTimestamp.textContent =
      "Updated " +
      now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    requestAnimationFrame(function () {
      ui.analysisBlock.classList.remove("analysis-block--updated");
    });
  }

  function buildPopupContent(port) {
    return (
      '<div class="port-popup">' +
      '<strong class="port-popup__name">' +
      port.portname +
      "</strong>" +
      '<span class="port-popup__country">' +
      port.country +
      "</span>" +
      '<span class="port-popup__stat">' +
      "Tanker vessels: <strong>" +
      port.vessel_count_tanker.toLocaleString() +
      "</strong>" +
      "</span>" +
      "</div>"
    );
  }

  function addPortMarkers(portFeatures) {
    const ports = portFeatures
      .map(function (feature) {
        const attrs = feature.attributes || {};
        const geometry = feature.geometry || {};

        const lat = geometry.y != null ? geometry.y : attrs.lat;
        const lon = geometry.x != null ? geometry.x : attrs.lon;
        const vesselCount = Number(attrs.vessel_count_tanker) || 0;

        if (lat == null || lon == null) {
          return null;
        }

        return {
          portid: attrs.portid,
          portname: attrs.portname || "Unknown Port",
          country: attrs.country || "—",
          vessel_count_tanker: vesselCount,
          lat: lat,
          lon: lon,
        };
      })
      .filter(Boolean);

    const counts = ports.map(function (port) {
      return port.vessel_count_tanker;
    });
    const minCount = Math.min.apply(null, counts);
    const maxCount = Math.max.apply(null, counts);

    ports.forEach(function (port) {
      const radius = getMarkerRadius(
        port.vessel_count_tanker,
        minCount,
        maxCount
      );

      const marker = L.circleMarker([port.lat, port.lon], {
        radius: radius,
        fillColor: MARKER_COLOR,
        color: "#67e8f9",
        weight: 1.5,
        opacity: 0.95,
        fillOpacity: 0.65,
      });

      marker.bindPopup(buildPopupContent(port));
      marker.on("click", function () {
        highlightMarker(marker);
        updateEconomicAnalysis(port);
      });
      portLayer.addLayer(marker);
    });

    console.log("Rendered " + ports.length + " port markers on map");
  }

  async function fetchPortData() {
    try {
      const [dailyData, portGeometryData] = await Promise.all([
        fetchArcGISPage(DAILY_PORTS_URL, 0, 2000),
        fetchAllArcGISFeatures(PORTS_GEOMETRY_URL),
      ]);

      const dailyFeatures = dailyData.features || [];
      const activityByPort = aggregateDailyPortActivity(dailyFeatures);

      console.log(
        "Daily port records fetched:",
        dailyFeatures.length,
        dailyData.exceededTransferLimit ? "(first page)" : ""
      );
      console.log(
        "Unique ports in daily activity sample:",
        activityByPort.size
      );
      console.log("Port geometries fetched:", portGeometryData.length);

      addPortMarkers(portGeometryData);
    } catch (error) {
      console.error("Failed to fetch or render port data:", error);
    }
  }

  function init() {
    console.log("System initialized");
    cacheDomElements();
    initMap();
    fetchPortData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
