/**
 * TankerMap — Main Application Controller
 */

(function () {
  "use strict";

  const STRATEGIC_CHOKEPOINTS = [
    { id: "suez", name: "Suez Canal", lat: 30.6, lon: 32.3, type: "canal" },
    { id: "panama", name: "Panama Canal", lat: 9.1, lon: -79.9, type: "canal" },
    { id: "hormuz", name: "Strait of Hormuz", lat: 26.6, lon: 56.3, type: "strategic" },
    { id: "bab", name: "Bab el-Mandeb", lat: 12.6, lon: 43.3, type: "strategic" },
    { id: "malacca", name: "Malacca Strait", lat: 2.5, lon: 101.3, type: "strategic" },
  ];

  const VULNERABILITY_THRESHOLDS = {
    criticalKm: 2000,
    highKm: 1200,
    mediumKm: 2500,
  };

  const DAILY_PORTS_URL =
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0/query?where=1%3D1&outFields=year,month,day,portname,country,portcalls_tanker,import_tanker,export_tanker,portid&outSR=4326&f=json";

  const PORTS_GEOMETRY_URL =
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/PortWatch_ports_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,country,continent,lat,lon,vessel_count_tanker&returnGeometry=true&outSR=4326&f=json";

  const OCEANIA_COUNTRIES = new Set([
    "Australia",
    "New Zealand",
    "Papua New Guinea",
    "Fiji",
    "New Caledonia",
    "French Polynesia",
    "Samoa",
    "Guam",
    "Solomon Islands",
    "Vanuatu",
    "Tonga",
    "Micronesia",
    "Palau",
    "Marshall Islands",
    "Kiribati",
    "Tuvalu",
    "Nauru",
    "American Samoa",
    "Cook Islands",
    "Timor-Leste",
  ]);

  const VULNERABILITY_RANK = {
    "CRITICAL (DISRUPTED)": 5,
    Critical: 4,
    High: 3,
    Medium: 2,
    Low: 1,
  };

  const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const TILE_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const MARKER_COLOR = "#22d3ee";
  const MARKER_SELECTED_COLOR = "#f97316";
  const MARKER_DISRUPTED_COLOR = "#f43f5e";
  const MARKER_DISRUPTED_STROKE = "#fb7185";
  const MARKER_MIN_RADIUS = 4;
  const MARKER_MAX_RADIUS = 18;

  const DISRUPTION_ALERT =
    " CRITICAL ALERT: Shipping lanes closed. Alternative routing around Cape of Good Hope required, adding an estimated 10–14 days to transit times and spiking spot freight rates.";

  let map;
  let portLayer;
  let selectedMarker = null;
  let selectedPortData = null;
  let viewMode = "global";
  let allPorts = [];
  let visiblePortEntries = [];
  const closedChokepoints = new Set();

  const ui = {
    panelContextLabel: null,
    portHeader: null,
    portName: null,
    portCountry: null,
    trafficLabel: null,
    trafficSublabel: null,
    congestionLabel: null,
    roleLabel: null,
    tankerTraffic: null,
    congestionRisk: null,
    supplyRole: null,
    nearestChokepoint: null,
    chokepointDistance: null,
    vulnerabilityScore: null,
    vulnerabilityCard: null,
    analysisText: null,
    analysisBlock: null,
    analysisTimestamp: null,
    chokepointToggles: null,
    simulatorStatus: null,
    filterRegion: null,
    filterRisk: null,
    filterSort: null,
    filterResultCount: null,
  };

  function cacheDomElements() {
    ui.panelContextLabel = document.getElementById("panel-context-label");
    ui.portHeader = document.getElementById("port-header");
    ui.portName = document.getElementById("selected-port-name");
    ui.portCountry = document.getElementById("selected-port-country");
    ui.trafficLabel = document.getElementById("metric-traffic-label");
    ui.trafficSublabel = document.getElementById("metric-traffic-sublabel");
    ui.congestionLabel = document.getElementById("metric-congestion-label");
    ui.roleLabel = document.getElementById("metric-role-label");
    ui.tankerTraffic = document.getElementById("metric-tanker-traffic");
    ui.congestionRisk = document.getElementById("metric-congestion-risk");
    ui.supplyRole = document.getElementById("metric-supply-role");
    ui.nearestChokepoint = document.getElementById("metric-nearest-chokepoint");
    ui.chokepointDistance = document.getElementById("metric-chokepoint-distance");
    ui.vulnerabilityScore = document.getElementById("metric-vulnerability-score");
    ui.vulnerabilityCard = document.querySelector(".vulnerability-card");
    ui.analysisText = document.getElementById("analysis-text");
    ui.analysisBlock = document.getElementById("economic-analysis");
    ui.analysisTimestamp = document.getElementById("analysis-timestamp");
    ui.chokepointToggles = document.getElementById("chokepoint-toggles");
    ui.simulatorStatus = document.getElementById("simulator-status");
    ui.filterRegion = document.getElementById("filter-region");
    ui.filterRisk = document.getElementById("filter-risk");
    ui.filterSort = document.getElementById("filter-sort");
    ui.filterResultCount = document.getElementById("filter-result-count");
  }

  function initFilterUI() {
    [ui.filterRegion, ui.filterRisk, ui.filterSort].forEach(function (control) {
      control.addEventListener("change", applyFiltersAndSort);
    });
  }

  function matchesRegion(entry, regionFilter) {
    if (regionFilter === "all") {
      return true;
    }

    const continent = (entry.port.continent || "").toLowerCase();
    const country = entry.port.country || "";

    if (regionFilter === "africa") {
      return continent === "africa";
    }

    if (regionFilter === "europe") {
      return continent === "europe";
    }

    if (regionFilter === "north-america") {
      return continent === "north america";
    }

    if (regionFilter === "south-america") {
      return continent === "south america";
    }

    if (regionFilter === "oceania") {
      return OCEANIA_COUNTRIES.has(country);
    }

    if (regionFilter === "asia") {
      return continent === "asia & pacific" && !OCEANIA_COUNTRIES.has(country);
    }

    return true;
  }

  function getPortRiskCategory(entry) {
    if (entry.isDisrupted) {
      return "critical-disrupted";
    }

    const vulnerability = assessVulnerability(entry.port, entry.proximity);

    if (vulnerability.score === "Critical") {
      return "critical-disrupted";
    }

    if (vulnerability.score === "High") {
      return "high";
    }

    if (vulnerability.score === "Medium") {
      return "moderate";
    }

    return "low";
  }

  function matchesRiskLevel(entry, riskFilter) {
    if (riskFilter === "all") {
      return true;
    }

    return getPortRiskCategory(entry) === riskFilter;
  }

  function getVulnerabilityRank(entry) {
    if (entry.isDisrupted) {
      return VULNERABILITY_RANK["CRITICAL (DISRUPTED)"];
    }

    const score = assessVulnerability(entry.port, entry.proximity).score;
    return VULNERABILITY_RANK[score] || 0;
  }

  function getCongestionRank(entry) {
    const count = entry.port.vessel_count_tanker;

    if (count > 150) {
      return 3;
    }

    if (count >= 50) {
      return 2;
    }

    return 1;
  }

  function sortPortEntries(entries, sortBy) {
    const sorted = entries.slice();

    sorted.sort(function (a, b) {
      if (sortBy === "vulnerability") {
        return getVulnerabilityRank(b) - getVulnerabilityRank(a);
      }

      if (sortBy === "congestion") {
        const congestionDiff = getCongestionRank(b) - getCongestionRank(a);
        if (congestionDiff !== 0) {
          return congestionDiff;
        }
      }

      return b.port.vessel_count_tanker - a.port.vessel_count_tanker;
    });

    return sorted;
  }

  function updateFilterResultCount(visibleCount) {
    const total = allPorts.length;

    if (visibleCount === total) {
      ui.filterResultCount.textContent = total + " ports";
      ui.filterResultCount.className =
        "font-mono text-[10px] uppercase tracking-wider text-slate-600";
      return;
    }

    ui.filterResultCount.textContent = visibleCount + " / " + total + " visible";
    ui.filterResultCount.className =
      "font-mono text-[10px] uppercase tracking-wider text-accent";
  }

  function applyFiltersAndSort() {
    if (!allPorts.length) {
      return;
    }

    const regionFilter = ui.filterRegion.value;
    const riskFilter = ui.filterRisk.value;
    const sortBy = ui.filterSort.value;

    let filtered = allPorts.filter(function (entry) {
      return matchesRegion(entry, regionFilter) && matchesRiskLevel(entry, riskFilter);
    });

    filtered = sortPortEntries(filtered, sortBy);
    visiblePortEntries = filtered;

    const visibleIds = new Set(
      filtered.map(function (entry) {
        return entry.port.portid;
      })
    );

    allPorts.forEach(function (entry) {
      const isVisible = visibleIds.has(entry.port.portid);

      if (isVisible) {
        if (!portLayer.hasLayer(entry.marker)) {
          portLayer.addLayer(entry.marker);
        }
      } else if (portLayer.hasLayer(entry.marker)) {
        portLayer.removeLayer(entry.marker);

        if (entry.marker === selectedMarker) {
          selectedMarker = null;
          selectedPortData = null;
          map.closePopup();
        }
      }
    });

    updateFilterResultCount(filtered.length);

    if (viewMode === "global" || !selectedPortData || !visibleIds.has(selectedPortData.portid)) {
      if (viewMode !== "global") {
        viewMode = "global";
      }
      showGlobalOutlook();
      return;
    }

    updateEconomicAnalysis(selectedPortData);
  }

  function isFilterActive() {
    return (
      ui.filterRegion.value !== "all" ||
      ui.filterRisk.value !== "all"
    );
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

    map.on("click", function () {
      showGlobalOutlook();
    });

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

  function findNearestChokepoint(lat, lon) {
    let nearest = null;
    let minDistance = Infinity;

    STRATEGIC_CHOKEPOINTS.forEach(function (chokepoint) {
      const distance = map.distance([lat, lon], [chokepoint.lat, chokepoint.lon]);

      if (distance < minDistance) {
        minDistance = distance;
        nearest = chokepoint;
      }
    });

    return {
      chokepoint: nearest,
      distanceMeters: minDistance,
      distanceKm: minDistance / 1000,
    };
  }

  function formatDistanceKm(distanceKm) {
    if (distanceKm < 1) {
      return Math.round(distanceKm * 1000) + " m";
    }

    return "~" + Math.round(distanceKm).toLocaleString() + " km";
  }

  function getChokepointByName(chokepointName) {
    return STRATEGIC_CHOKEPOINTS.find(function (cp) {
      return cp.name === chokepointName;
    });
  }

  function computeGlobalStats() {
    const source = visiblePortEntries;
    let totalTankers = 0;
    let elevatedRiskCount = 0;
    let disruptedCount = 0;

    source.forEach(function (entry) {
      totalTankers += entry.port.vessel_count_tanker;

      if (entry.isDisrupted) {
        disruptedCount += 1;
        elevatedRiskCount += 1;
        return;
      }

      const vulnerability = assessVulnerability(entry.port, entry.proximity);
      if (vulnerability.score === "High" || vulnerability.score === "Critical") {
        elevatedRiskCount += 1;
      }
    });

    return {
      totalTankers: totalTankers,
      elevatedRiskCount: elevatedRiskCount,
      disruptedCount: disruptedCount,
      totalPorts: source.length,
      totalUniverse: allPorts.length,
    };
  }

  function getEffectiveVulnerability(portData, proximity) {
    if (closedChokepoints.has(proximity.chokepoint.id)) {
      return {
        score: "CRITICAL (DISRUPTED)",
        scoreClass: "text-rose-400",
        cardClass: "vulnerability-card--critical",
        isDisrupted: true,
      };
    }

    const base = assessVulnerability(portData, proximity);
    base.isDisrupted = false;
    return base;
  }

  function restoreMarkerStyle(entry) {
    entry.marker.setStyle({
      radius: entry.baseRadius,
      fillColor: MARKER_COLOR,
      color: "#67e8f9",
      weight: 1.5,
      opacity: 0.95,
      fillOpacity: 0.65,
    });

    const element = entry.marker.getElement();
    if (element) {
      element.classList.remove("marker-disrupted");
    }
  }

  function applyDisruptedMarkerStyle(entry) {
    entry.marker.setStyle({
      radius: entry.baseRadius,
      fillColor: MARKER_DISRUPTED_COLOR,
      color: MARKER_DISRUPTED_STROKE,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85,
    });

    const element = entry.marker.getElement();
    if (element) {
      element.classList.add("marker-disrupted");
    }
  }

  function applyDisruptionState() {
    allPorts.forEach(function (entry) {
      const isDisrupted = closedChokepoints.has(entry.proximity.chokepoint.id);
      entry.isDisrupted = isDisrupted;

      if (entry.marker === selectedMarker) {
        return;
      }

      if (isDisrupted) {
        applyDisruptedMarkerStyle(entry);
      } else {
        restoreMarkerStyle(entry);
      }
    });

    updateSimulatorStatus();
  }

  function simulateDisruption(chokepointName, isClosed) {
    const chokepoint = getChokepointByName(chokepointName);

    if (!chokepoint) {
      console.error("Unknown chokepoint:", chokepointName);
      return;
    }

    if (isClosed) {
      closedChokepoints.add(chokepoint.id);
    } else {
      closedChokepoints.delete(chokepoint.id);
    }

    applyDisruptionState();
    applyFiltersAndSort();

    if (viewMode === "port" && selectedPortData) {
      const isVisible = visiblePortEntries.some(function (entry) {
        return entry.port.portid === selectedPortData.portid;
      });

      if (isVisible) {
        updateEconomicAnalysis(selectedPortData);
      }
    }
  }

  function updateSimulatorStatus() {
    if (closedChokepoints.size === 0) {
      ui.simulatorStatus.textContent = "All chokepoints active";
      ui.simulatorStatus.className =
        "simulator-status mt-3 font-mono text-[10px] uppercase tracking-wider text-slate-600";
      return;
    }

    const disruptedPorts = allPorts.filter(function (entry) {
      return entry.isDisrupted;
    }).length;

    ui.simulatorStatus.textContent =
      closedChokepoints.size +
      " closure(s) active · " +
      disruptedPorts +
      " ports disrupted";
    ui.simulatorStatus.className =
      "simulator-status mt-3 font-mono text-[10px] uppercase tracking-wider text-rose-400";
  }

  function initSimulatorUI() {
    ui.chokepointToggles.innerHTML = "";

    STRATEGIC_CHOKEPOINTS.forEach(function (chokepoint) {
      const row = document.createElement("div");
      row.className = "chokepoint-toggle";
      row.innerHTML =
        '<span class="chokepoint-toggle__name">' +
        chokepoint.name +
        '</span><button type="button" class="chokepoint-toggle__btn chokepoint-toggle__btn--open" data-chokepoint="' +
        chokepoint.name +
        '" aria-pressed="false">Active</button>';

      const button = row.querySelector("button");
      button.addEventListener("click", function () {
        const isClosed = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", isClosed ? "true" : "false");
        button.textContent = isClosed ? "Closed" : "Active";
        button.className =
          "chokepoint-toggle__btn " +
          (isClosed ? "chokepoint-toggle__btn--closed" : "chokepoint-toggle__btn--open");
        simulateDisruption(chokepoint.name, isClosed);
      });

      ui.chokepointToggles.appendChild(row);
    });
  }

  function clearMarkerSelection() {
    if (!selectedMarker) {
      return;
    }

    const entry = allPorts.find(function (item) {
      return item.marker === selectedMarker;
    });

    if (entry) {
      if (entry.isDisrupted) {
        applyDisruptedMarkerStyle(entry);
      } else {
        restoreMarkerStyle(entry);
      }
    }

    selectedMarker = null;
    selectedPortData = null;
    map.closePopup();
  }

  function showGlobalOutlook() {
    viewMode = "global";
    clearMarkerSelection();

    const stats = computeGlobalStats();

    ui.panelContextLabel.textContent = "Global Outlook";
    ui.portHeader.classList.remove("analysis-header--active");
    ui.portHeader.classList.add("analysis-header--global");

    ui.portName.textContent = "Global Maritime Outlook";
    ui.portName.className = "text-lg font-semibold leading-snug text-white";
    ui.portCountry.textContent = "IMF PortWatch · Aggregate Intelligence";
    ui.portCountry.className =
      "mt-1 font-mono text-[11px] uppercase tracking-widest text-slate-500";

    ui.trafficLabel.textContent = "Total Active Tankers";
    ui.trafficSublabel.textContent = isFilterActive()
      ? "Filtered subset · " +
        stats.totalPorts.toLocaleString() +
        " of " +
        stats.totalUniverse.toLocaleString() +
        " ports visible"
      : "Tracked globally across all port nodes";
    ui.tankerTraffic.textContent = stats.totalTankers.toLocaleString();

    ui.congestionLabel.textContent = "Elevated Risk Ports";
    ui.congestionRisk.textContent = stats.elevatedRiskCount.toLocaleString();
    setMetricClasses(
      ui.congestionRisk,
      "mt-1 font-mono text-lg font-semibold",
      stats.elevatedRiskCount > 0 ? "text-amber-400" : "text-emerald-400"
    );

    ui.roleLabel.textContent = "Ports Monitored";
    ui.supplyRole.textContent = stats.totalPorts.toLocaleString();
    setMetricClasses(
      ui.supplyRole,
      "mt-1 font-mono text-lg font-medium",
      "text-sky-300"
    );

    ui.nearestChokepoint.textContent = STRATEGIC_CHOKEPOINTS.length + " Strategic Chokepoints";
    ui.nearestChokepoint.className =
      "vulnerability-metric__value mt-1 text-sm font-medium text-fuchsia-200";

    ui.chokepointDistance.textContent =
      stats.elevatedRiskCount + " ports at High / Critical risk";
    ui.chokepointDistance.className =
      "vulnerability-metric__value mt-1 font-mono text-sm text-violet-300";

    if (stats.disruptedCount > 0) {
      ui.vulnerabilityScore.textContent =
        stats.disruptedCount + " CRITICAL (DISRUPTED)";
      setMetricClasses(
        ui.vulnerabilityScore,
        "vulnerability-metric__value mt-1 font-mono text-sm font-semibold uppercase tracking-wide",
        "text-rose-400"
      );
      ui.vulnerabilityCard.classList.remove(
        "vulnerability-card--low",
        "vulnerability-card--medium",
        "vulnerability-card--high"
      );
      ui.vulnerabilityCard.classList.add("vulnerability-card--critical");
    } else {
      ui.vulnerabilityScore.textContent = "Nominal";
      setMetricClasses(
        ui.vulnerabilityScore,
        "vulnerability-metric__value mt-1 font-mono text-sm font-semibold uppercase tracking-wide",
        "text-emerald-400"
      );
      ui.vulnerabilityCard.classList.remove(
        "vulnerability-card--critical",
        "vulnerability-card--high",
        "vulnerability-card--medium"
      );
      ui.vulnerabilityCard.classList.add("vulnerability-card--low");
    }

    let analysis =
      "Global maritime intelligence synthesizes " +
      stats.totalTankers.toLocaleString() +
      " active tanker vessel observations across " +
      stats.totalPorts.toLocaleString() +
      (isFilterActive()
        ? " filtered port nodes (of " + stats.totalUniverse.toLocaleString() + " total)"
        : " port nodes") +
      ". Currently, " +
      stats.elevatedRiskCount.toLocaleString() +
      " visible ports register elevated vulnerability (High or Critical) based on throughput density and proximity to strategic chokepoints. Select any port marker for granular economic inference, or use the shock simulator below to model geopolitical disruption scenarios.";

    if (stats.disruptedCount > 0) {
      analysis +=
        " SIMULATION ACTIVE: " +
        stats.disruptedCount.toLocaleString() +
        " port nodes are now flagged as CRITICAL (DISRUPTED) due to simulated chokepoint closures. Expect immediate freight rate volatility and extended transit times across affected trade lanes.";
    }

    ui.analysisText.textContent = analysis;
    ui.analysisText.className = "analysis-text text-sm leading-relaxed text-slate-300";
    ui.analysisBlock.classList.add("analysis-block--updated");

    const now = new Date();
    ui.analysisTimestamp.textContent =
      "Global snapshot " +
      now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    requestAnimationFrame(function () {
      ui.analysisBlock.classList.remove("analysis-block--updated");
    });
  }

  function assessVulnerability(portData, proximity) {
    const count = portData.vessel_count_tanker;
    const distanceKm = proximity.distanceKm;
    const chokepoint = proximity.chokepoint;
    const isPrimaryHub = count > 150;
    const isRegional = count >= 50 && count <= 150;
    const isStrategicGate =
      chokepoint.id === "hormuz" || chokepoint.id === "bab";
    const isCanal = chokepoint.id === "suez" || chokepoint.id === "panama";

    if (
      isPrimaryHub &&
      isStrategicGate &&
      distanceKm <= VULNERABILITY_THRESHOLDS.criticalKm
    ) {
      return {
        score: "Critical",
        scoreClass: "text-fuchsia-400",
        cardClass: "vulnerability-card--critical",
      };
    }

    if (
      (isPrimaryHub && distanceKm <= VULNERABILITY_THRESHOLDS.highKm) ||
      (isRegional && isStrategicGate && distanceKm <= 1500)
    ) {
      return {
        score: "High",
        scoreClass: "text-purple-400",
        cardClass: "vulnerability-card--high",
      };
    }

    if (
      distanceKm <= VULNERABILITY_THRESHOLDS.mediumKm ||
      (isRegional && distanceKm <= 2000) ||
      (isCanal && distanceKm <= 3000)
    ) {
      return {
        score: "Medium",
        scoreClass: "text-violet-400",
        cardClass: "vulnerability-card--medium",
      };
    }

    return {
      score: "Low",
      scoreClass: "text-emerald-400",
      cardClass: "vulnerability-card--low",
    };
  }

  function buildVulnerabilityNarrative(portData, proximity, vulnerability, baseRole) {
    const chokepoint = proximity.chokepoint;
    const distanceLabel = formatDistanceKm(proximity.distanceKm);
    const isPrimaryHub = baseRole === "Global Chokepoint / Primary Energy Hub";

    if (
      vulnerability.score === "Critical" &&
      (chokepoint.id === "hormuz" || chokepoint.id === "bab")
    ) {
      return (
        " Strategic vulnerability assessment flags CRITICAL exposure: " +
        portData.portname +
        " sits within " +
        distanceLabel +
        " of the " +
        chokepoint.name +
        ", one of the world's most geopolitically sensitive energy corridors. Regional tensions, naval interdiction, or blockade scenarios could sever Gulf export routes overnight, forcing tanker rerouting around the Cape of Good Hope and adding 10–14 days to voyage times. Such disruptions historically compress effective global tanker supply and can instantly reprice Brent crude risk premia across futures markets."
      );
    }

    if (chokepoint.id === "hormuz" || chokepoint.id === "bab") {
      return (
        " Proximity to the " +
        chokepoint.name +
        " (" +
        distanceLabel +
        ") elevates geopolitical energy security risk for " +
        portData.country +
        ". Analysts should monitor regional conflict escalations, insurance war-risk surcharges, and the economics of Cape rerouting as leading indicators of supply shock transmission into global energy markets."
      );
    }

    if (chokepoint.id === "suez" || chokepoint.id === "panama") {
      return (
        " Dependence on the " +
        chokepoint.name +
        " (" +
        distanceLabel +
        ") introduces canal-specific systemic vulnerability. Climate-induced draft restrictions, drought-related transit limits, and periodic congestion at lock systems can strand cargoes and inflate time-charter equivalent (TCE) rates. " +
        (isPrimaryHub
          ? "As a primary hub, alternative-route economics—longer cape voyages versus canal toll structures—become a core variable in this port's marginal cost of trade."
          : "Regional shippers must continuously evaluate alternative-route economics when canal reliability deteriorates.")
      );
    }

    if (chokepoint.id === "malacca") {
      return (
        " Proximity to the Malacca Strait (" +
        distanceLabel +
        ") links this port to the densest tanker transit lane connecting the Indian Ocean and Pacific basin. Any disruption—piracy resurgence, territorial friction, or accident-driven closures—would cascade through Asian refining margins and spot crude differentials with disproportionate speed."
      );
    }

    return (
      " Nearest monitored chokepoint: " +
      chokepoint.name +
      " (" +
      distanceLabel +
      "). While geographically distant, systemic shocks at major maritime gateways propagate through freight markets and can still influence this port's indirect cost base via insurance, bunker fuel, and charter-rate spillovers."
    );
  }

  function generateEconomicInference(portData, proximity, vulnerability) {
    const count = portData.vessel_count_tanker;
    const name = portData.portname;
    const country = portData.country;
    let base;

    if (count > 150) {
      base = {
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
    } else if (count >= 50 && count <= 150) {
      base = {
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
    } else {
      base = {
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

    base.analysis += buildVulnerabilityNarrative(
      portData,
      proximity,
      vulnerability,
      base.supplyChainRole
    );

    return base;
  }

  function setMetricClasses(element, baseClasses, colorClass) {
    element.className = baseClasses + " " + colorClass;
  }

  function highlightMarker(marker, entry) {
    if (selectedMarker && selectedMarker !== marker) {
      const previous = allPorts.find(function (item) {
        return item.marker === selectedMarker;
      });

      if (previous) {
        if (previous.isDisrupted) {
          applyDisruptedMarkerStyle(previous);
        } else {
          restoreMarkerStyle(previous);
        }
      }
    }

    marker.setStyle({
      fillColor: entry.isDisrupted ? MARKER_DISRUPTED_COLOR : MARKER_SELECTED_COLOR,
      color: entry.isDisrupted ? "#fda4af" : "#fdba74",
      weight: 2.5,
      fillOpacity: 0.95,
    });

    selectedMarker = marker;
    marker.bringToFront();
    marker.openPopup();
  }

  function updateVulnerabilityCard(vulnerability, proximity) {
    ui.nearestChokepoint.textContent = proximity.chokepoint.name;
    ui.nearestChokepoint.className =
      "vulnerability-metric__value mt-1 text-sm font-medium text-fuchsia-200";

    ui.chokepointDistance.textContent = formatDistanceKm(proximity.distanceKm);
    ui.chokepointDistance.className =
      "vulnerability-metric__value mt-1 font-mono text-sm text-violet-300";

    ui.vulnerabilityScore.textContent = vulnerability.score;
    setMetricClasses(
      ui.vulnerabilityScore,
      "vulnerability-metric__value mt-1 font-mono text-sm font-semibold uppercase tracking-wide",
      vulnerability.scoreClass
    );

    ui.vulnerabilityCard.classList.remove(
      "vulnerability-card--critical",
      "vulnerability-card--high",
      "vulnerability-card--medium",
      "vulnerability-card--low"
    );
    ui.vulnerabilityCard.classList.add(vulnerability.cardClass);
  }

  function updateEconomicAnalysis(portData) {
    viewMode = "port";
    selectedPortData = portData;

    const entry = allPorts.find(function (item) {
      return item.port.portid === portData.portid;
    });
    const proximity = entry ? entry.proximity : findNearestChokepoint(portData.lat, portData.lon);
    const vulnerability = getEffectiveVulnerability(portData, proximity);
    const baseVulnerability = assessVulnerability(portData, proximity);
    const inference = generateEconomicInference(portData, proximity, baseVulnerability);

    ui.panelContextLabel.textContent = "Selected Port";
    ui.portHeader.classList.remove("analysis-header--global");
    ui.portHeader.classList.add("analysis-header--active");

    ui.portName.textContent = portData.portname;
    ui.portName.className = "text-lg font-semibold leading-snug text-white";

    ui.portCountry.textContent = portData.country;
    ui.portCountry.className =
      "mt-1 font-mono text-[11px] uppercase tracking-widest text-accent";

    ui.trafficLabel.textContent = "Total Tanker Traffic";
    ui.trafficSublabel.textContent = "Distinct tanker vessels observed";
    ui.tankerTraffic.textContent = portData.vessel_count_tanker.toLocaleString();

    ui.congestionLabel.textContent = "Congestion Risk";
    ui.congestionRisk.textContent = inference.congestionRisk;
    setMetricClasses(
      ui.congestionRisk,
      "mt-1 font-mono text-lg font-semibold",
      inference.riskClass
    );

    ui.roleLabel.textContent = "Supply Chain Role";
    ui.supplyRole.textContent = inference.supplyChainRole;
    setMetricClasses(
      ui.supplyRole,
      "mt-1 text-sm font-medium leading-snug",
      inference.roleClass
    );

    updateVulnerabilityCard(vulnerability, proximity);

    let analysisText = inference.analysis;
    if (vulnerability.isDisrupted) {
      analysisText += DISRUPTION_ALERT;
      ui.analysisText.className =
        "analysis-text text-sm leading-relaxed text-slate-300 analysis-text--alert";
    } else {
      ui.analysisText.className = "analysis-text text-sm leading-relaxed text-slate-300";
    }

    ui.analysisText.textContent = analysisText;

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
    allPorts = [];

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
          continent: attrs.continent || "",
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
      const proximity = findNearestChokepoint(port.lat, port.lon);

      const marker = L.circleMarker([port.lat, port.lon], {
        radius: radius,
        fillColor: MARKER_COLOR,
        color: "#67e8f9",
        weight: 1.5,
        opacity: 0.95,
        fillOpacity: 0.65,
      });

      const entry = {
        port: port,
        marker: marker,
        proximity: proximity,
        baseRadius: radius,
        isDisrupted: false,
      };

      allPorts.push(entry);

      marker.on("add", function () {
        const element = marker.getElement();
        if (element) {
          element.classList.add("port-marker");
        }
      });

      marker.bindPopup(buildPopupContent(port));
      marker.on("click", function (event) {
        L.DomEvent.stopPropagation(event);
        highlightMarker(marker, entry);
        updateEconomicAnalysis(port);
      });
      portLayer.addLayer(marker);
    });

    console.log("Rendered " + ports.length + " port markers on map");
    visiblePortEntries = allPorts.slice();
    applyFiltersAndSort();
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
    initFilterUI();
    initSimulatorUI();
    initMap();
    fetchPortData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
