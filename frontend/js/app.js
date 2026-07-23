const IS_LOCAL_HOST = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
const API_HOST = IS_LOCAL_HOST ? "http://127.0.0.1:5001" : window.location.origin;
const LOCATION_SEARCH_RADIUS_KM = 5;

let panelHistory = ["1"];
let historyIndex = 0;
let districtStatsData = {};
let processedHouses = [];
let activeColors = new Set(["green", "yellow", "red"]);
let activeMode = "recommended";
let activeDistrictFilter = "전체";
let targetPoint = null;
let leafletMap = null;
let leafletMarkers = [];
let visibleHouses = [];
let userInputs = {
    name: "",
    searchBasis: "location",
    hopeDistrict: "",
    rank: "1",
    score: 6,
    supplyType: "신규공급",
    half: "상",
    targetLocation: "",
};

const districtOptions = ["전체"];

document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    updateSearchBasisUI();
    fetchDistrictStats();
});

function bindEvents() {
    document.getElementById("start-btn").addEventListener("click", () => goToPanel("2"));
    document.getElementById("prev-btn").addEventListener("click", moveBack);
    document.getElementById("combined-form").addEventListener("submit", startAnalysisFlow);

    document.querySelectorAll("#rank-chip-group .chip-btn").forEach((button) => {
        button.addEventListener("click", () => setChip("rank", button, button.dataset.rank));
    });

    document.querySelectorAll("#supply-chip-group .chip-btn").forEach((button) => {
        button.addEventListener("click", () => setChip("supplyType", button, button.dataset.supply));
    });

    document.querySelectorAll("#search-basis-group .chip-btn").forEach((button) => {
        button.addEventListener("click", () => setSearchBasis(button));
    });

    document.querySelectorAll(".filter-chip[data-color]").forEach((button) => {
        button.addEventListener("click", () => toggleColorFilter(button));
    });

    document.querySelectorAll(".mode-chip").forEach((button) => {
        button.addEventListener("click", () => setRecommendationMode(button));
    });

    document.getElementById("district-filter-tabs").addEventListener("click", (event) => {
        const button = event.target.closest(".district-chip");
        if (!button) return;
        setDistrictFilter(button);
    });
}

async function fetchDistrictStats() {
    try {
        const response = await fetch(`${API_HOST}/api/districts`);
        if (!response.ok) throw new Error("자치구 정보를 불러오지 못했습니다.");

        districtStatsData = await response.json();
        const districts = Object.keys(districtStatsData)
            .filter((district) => district !== "전체")
            .sort((a, b) => a.localeCompare(b, "ko"));

        districtOptions.splice(1, districtOptions.length - 1, ...districts);
        populateDistrictSelects();
    } catch (error) {
        console.error(error);
        showSelectFallback();
    }
}

function populateDistrictSelects() {
    const hopeSelect = document.getElementById("in-hope-district");

    hopeSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "자치구 선택";
    placeholder.disabled = true;
    placeholder.selected = true;
    hopeSelect.appendChild(placeholder);

    districtOptions.forEach((district) => {
        const option = document.createElement("option");
        option.value = district;
        const count = districtStatsData[district]?.listing_count;
        option.textContent = count ? `${district} (${count}건)` : district;
        hopeSelect.appendChild(option);
    });

    hopeSelect.value = "";
    userInputs.hopeDistrict = "";
    updateSearchBasisUI();
}

function showSelectFallback() {
    const fallback = [
        "전체",
        "강남구",
        "강동구",
        "강북구",
        "강서구",
        "관악구",
        "광진구",
        "구로구",
        "금천구",
        "노원구",
        "도봉구",
        "동대문구",
        "동작구",
        "마포구",
        "서대문구",
        "서초구",
        "성동구",
        "성북구",
        "송파구",
        "양천구",
        "영등포구",
        "은평구",
        "종로구",
        "중구",
        "중랑구",
    ];
    districtOptions.splice(0, districtOptions.length, ...fallback);
    populateDistrictSelects();
}

function setChip(category, element, value) {
    element.parentElement.querySelectorAll(".chip-btn").forEach((button) => button.classList.remove("active"));
    element.classList.add("active");
    userInputs[category] = value;

    if (category === "rank") {
        const scoreInput = document.getElementById("in-score");
        const scoreLabel = document.getElementById("score-label");
        const maxScore = value === "1" ? 14 : 11;
        scoreInput.max = String(maxScore);
        scoreLabel.textContent = `가점 (0~${maxScore}점)`;
        if (Number(scoreInput.value) > maxScore) {
            scoreInput.value = String(maxScore);
        }
    }
}

function setSearchBasis(element) {
    element.parentElement.querySelectorAll(".chip-btn").forEach((button) => button.classList.remove("active"));
    element.classList.add("active");
    userInputs.searchBasis = element.dataset.basis;
    updateSearchBasisUI();
}

function updateSearchBasisUI() {
    const label = document.getElementById("hope-district-label");
    const hint = document.getElementById("search-basis-hint");
    const locationInput = document.getElementById("in-target-location");
    const districtSelect = document.getElementById("in-hope-district");

    if (userInputs.searchBasis === "district") {
        label.textContent = "입주 희망 자치구";
        hint.textContent = "선택한 자치구 안의 매물만 보여줍니다. 특정 위치 입력은 꺼집니다.";
        districtSelect.disabled = false;
        districtSelect.required = true;
        locationInput.value = "";
        userInputs.targetLocation = "";
        locationInput.disabled = true;
        locationInput.required = false;
        locationInput.placeholder = "특정 위치 기준에서만 입력 가능";
    } else {
        label.textContent = "입주 희망 자치구";
        hint.textContent = "구 경계와 상관없이 입력한 위치 가까운 매물을 추천합니다.";
        districtSelect.value = "";
        userInputs.hopeDistrict = "";
        districtSelect.disabled = true;
        districtSelect.required = false;
        locationInput.disabled = false;
        locationInput.required = true;
        locationInput.placeholder = "예: 고려대학교, 서울시립대, 강남역";
    }
}

function updatePanelUI() {
    document.querySelectorAll(".step-panel").forEach((panel) => panel.classList.remove("active"));
    document.getElementById(`panel-${panelHistory[historyIndex]}`).classList.add("active");
    document.getElementById("prev-btn").disabled = historyIndex === 0;
}

function goToPanel(panelId) {
    panelHistory = panelHistory.slice(0, historyIndex + 1);
    panelHistory.push(panelId);
    historyIndex += 1;
    updatePanelUI();
}

function moveBack() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    updatePanelUI();
}

async function startAnalysisFlow(event) {
    event.preventDefault();

    const scoreInput = document.getElementById("in-score");
    const maxScore = Number(scoreInput.max);

    userInputs.name = document.getElementById("in-name").value.trim() || "사용자";
    userInputs.hopeDistrict = document.getElementById("in-hope-district").value;
    userInputs.score = Math.min(Number(scoreInput.value), maxScore);
    userInputs.targetLocation = document.getElementById("in-target-location").value.trim();

    if (userInputs.searchBasis === "district" && !userInputs.hopeDistrict) {
        alert("입주 희망 자치구를 선택하세요.");
        return;
    }

    if (userInputs.searchBasis === "location" && !userInputs.targetLocation) {
        alert("특정 위치 기준 검색에는 학교/직장/장소명을 입력해야 합니다.");
        return;
    }

    document.getElementById("panel-2").classList.remove("active");
    document.getElementById("panel-loading").classList.add("active");

    try {
        const result = await requestPrediction();
        executeMatching(result);
        document.getElementById("panel-loading").classList.remove("active");
        goToPanel("3");
    } catch (error) {
        console.error(error);
        document.getElementById("panel-loading").classList.remove("active");
        document.getElementById("panel-2").classList.add("active");
        alert("분석에 실패했습니다. Flask 백엔드 서버가 실행 중인지 확인하세요.");
    }
}

async function requestPrediction() {
    const requestDistrict = userInputs.searchBasis === "district" ? userInputs.hopeDistrict : "전체";
    const stats = districtStatsData[requestDistrict] || districtStatsData["전체"] || {};
    const response = await fetch(`${API_HOST}/api/predict`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            district: requestDistrict,
            rank: Number(userInputs.rank),
            score: userInputs.score,
            supply_type: userInputs.supplyType,
            half: userInputs.half,
            target_location: userInputs.targetLocation,
            include_map: true,
            pyung: stats.avg_pyung,
            traffic: stats.avg_traffic,
        }),
    });

    if (!response.ok) {
        throw new Error("예측 API 호출 실패");
    }

    return response.json();
}

function executeMatching(result) {
    const history = result.history || [];
    targetPoint = normalizePoint(result.target_location);
    processedHouses = history.map((item) => {
        const cutoffScore = toCombinedScore(item.cutoff_rank, item.cutoff_score);
        const userScore = toCombinedScore(`${userInputs.rank}순위`, `${userInputs.score}점`);
        const deltaScore = userScore - cutoffScore;
        const percent = clamp(Math.round((1 / (1 + Math.exp(-0.35 * deltaScore))) * 100), 1, 99);
        const badge = getBadge(percent);
        const totalCost = getTotalCost(item);

        return {
            ...item,
            cutoffCombinedScore: cutoffScore,
            calculatedProb: percent,
            signalClass: badge.className,
            signalIcon: badge.icon,
            signalColor: badge.color,
            totalCost,
            lat: toFiniteNumber(item.lat),
            lng: toFiniteNumber(item.lng),
            distance_km: toFiniteNumber(item.distance_km),
        };
    });

    activeDistrictFilter = "전체";
    renderDistrictFilters();

    activeMode = userInputs.searchBasis === "location" ? "location" : "recommended";
    document.querySelectorAll(".mode-chip").forEach((button) => {
        button.classList.toggle("active", button.dataset.mode === activeMode);
    });

    document.getElementById("list-user-title").innerHTML =
        `<strong style="color:var(--primary)">${escapeHtml(userInputs.name)}</strong> 님의 분석 결과`;
    document.getElementById("result-subtitle").innerHTML =
        getResultSubtitle();
    document.getElementById("summary-prob").textContent = `${result.probability}%`;
    document.getElementById("summary-status").textContent = result.status;
    document.getElementById("summary-count").textContent = `${getBaseCandidateHouses(processedHouses).length}건`;

    applyFiltersAndRender();
}

function toCombinedScore(rankText, scoreText) {
    const rankMatch = String(rankText || "").match(/[123]/);
    const scoreMatch = String(scoreText || "").match(/[-+]?\d+/);
    const rank = rankMatch ? Number(rankMatch[0]) : 3;
    const score = scoreMatch ? Number(scoreMatch[0]) : 0;
    const rankValue = { 1: 3, 2: 2, 3: 1 }[rank] || 1;
    return rankValue * 15 + score;
}

function getBadge(percent) {
    if (percent >= 75) return { className: "badge-green", icon: "상", color: "green" };
    if (percent < 40) return { className: "badge-red", icon: "하", color: "red" };
    return { className: "badge-yellow", icon: "중", color: "yellow" };
}

function toggleColorFilter(element) {
    const color = element.dataset.color;
    if (activeColors.has(color)) {
        activeColors.delete(color);
        element.classList.remove("active");
    } else {
        activeColors.add(color);
        element.classList.add("active");
    }

    applyFiltersAndRender();
}

function setRecommendationMode(element) {
    activeMode = element.dataset.mode;
    element.parentElement.querySelectorAll(".mode-chip").forEach((chip) => chip.classList.remove("active"));
    element.classList.add("active");
    applyFiltersAndRender();
}

function setDistrictFilter(element) {
    activeDistrictFilter = element.dataset.district || "전체";
    document.querySelectorAll("#district-filter-tabs .district-chip").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.district === activeDistrictFilter);
    });
    applyFiltersAndRender();
}

function renderDistrictFilters() {
    const container = document.getElementById("district-filter-tabs");
    container.innerHTML = "";

    if (userInputs.searchBasis !== "location") {
        container.hidden = true;
        return;
    }

    const baseHouses = getBaseCandidateHouses(processedHouses);
    const districts = [...new Set(
        baseHouses
            .filter((house) => Number.isFinite(house.distance_km))
            .map((house) => house.district)
            .filter(Boolean)
    )].sort((a, b) => {
        const distanceA = getDistrictMinDistance(a);
        const distanceB = getDistrictMinDistance(b);
        return distanceA - distanceB || a.localeCompare(b, "ko");
    });

    if (districts.length === 0) {
        container.hidden = true;
        return;
    }

    container.hidden = false;
    container.insertAdjacentHTML(
        "beforeend",
        `<button class="district-chip active" type="button" data-district="전체">전체</button>`
    );

    districts.forEach((district) => {
        const count = baseHouses.filter((house) => house.district === district && Number.isFinite(house.distance_km)).length;
        container.insertAdjacentHTML(
            "beforeend",
            `<button class="district-chip" type="button" data-district="${escapeHtml(district)}">${escapeHtml(district)} ${count}</button>`
        );
    });
}

function applyFiltersAndRender() {
    const hint = document.getElementById("result-hint");
    let houses = getBaseCandidateHouses(processedHouses).filter((house) => activeColors.has(house.signalColor));
    let message = "";

    if (activeColors.size === 0) {
        hint.textContent = "초록/노랑/빨강 중 하나 이상 선택하세요.";
        renderMap([]);
        renderHouseList([]);
        return;
    }

    if (userInputs.searchBasis === "location" && activeDistrictFilter !== "전체") {
        houses = houses.filter((house) => house.district === activeDistrictFilter);
    }

    if (activeMode === "recommended") {
        houses = houses.sort(compareRecommended);
        message = getRecommendedMessage();
    } else if (activeMode === "location") {
        const hasDistance = houses.some((house) => Number.isFinite(house.distance_km));
        houses = houses
            .filter((house) => Number.isFinite(house.distance_km))
            .sort((a, b) => a.distance_km - b.distance_km || comparePrice(a, b) || b.calculatedProb - a.calculatedProb)
            .slice(0, 5);
        message = hasDistance
            ? `${getDistrictFilterLabel()}입력한 위치에서 직선 ${LOCATION_SEARCH_RADIUS_KM}km 이내 가까운 5개입니다.`
            : "특정 위치 거리 계산에는 KAKAO_REST_API_KEY와 위치 입력이 필요합니다.";
    } else if (activeMode === "price") {
        const hasPrice = houses.some((house) => Number.isFinite(house.totalCost));
        houses = houses.sort(comparePriceThenProbability).slice(0, 10);
        message = hasPrice
            ? "월세/보증금 낮은 순 10개입니다."
            : "현재 데이터에는 월세/보증금 컬럼이 없어 확률 높은 순으로 대체 정렬했습니다.";
    } else if (activeMode === "station") {
        houses = houses
            .filter((house) => normalizedNumber(house.traffic) <= 10)
            .sort((a, b) => normalizedNumber(a.traffic) - normalizedNumber(b.traffic) || b.calculatedProb - a.calculatedProb)
            .slice(0, 10);
        message = "도보 10분 이내 역세권 매물 10개입니다. 2분 이내 매물을 먼저 보여줍니다.";
    }

    hint.textContent = message;
    visibleHouses = houses;
    renderMap(houses);
    renderHouseList(houses);
}

function getBaseCandidateHouses(houses) {
    if (userInputs.searchBasis !== "location") {
        return houses;
    }

    return houses.filter((house) => (
        Number.isFinite(house.distance_km)
        && house.distance_km <= LOCATION_SEARCH_RADIUS_KM
    ));
}

function compareRecommended(a, b) {
    if (userInputs.searchBasis === "location") {
        return (
            compareDistance(a, b)
            || getStationPriority(b) - getStationPriority(a)
            || comparePrice(a, b)
            || b.calculatedProb - a.calculatedProb
            || normalizedNumber(a.traffic) - normalizedNumber(b.traffic)
        );
    }

    return (
        getStationPriority(b) - getStationPriority(a)
        || comparePrice(a, b)
        || b.calculatedProb - a.calculatedProb
        || normalizedNumber(a.traffic) - normalizedNumber(b.traffic)
    );
}

function getDistrictPriority(house) {
    if (userInputs.hopeDistrict !== "전체" && house.district === userInputs.hopeDistrict) return 2;
    return 0;
}

function getDistrictMinDistance(district) {
    return getBaseCandidateHouses(processedHouses)
        .filter((house) => house.district === district && Number.isFinite(house.distance_km))
        .reduce((minDistance, house) => Math.min(minDistance, house.distance_km), Number.MAX_SAFE_INTEGER);
}

function getDistrictFilterLabel() {
    return activeDistrictFilter === "전체" ? "" : `${activeDistrictFilter} 조건으로 `;
}

function getStationPriority(house) {
    const traffic = normalizedNumber(house.traffic);
    if (traffic <= 2) return 2;
    if (traffic <= 10) return 1;
    return 0;
}

function getResultSubtitle() {
    if (userInputs.searchBasis === "district") {
        return `<strong>${escapeHtml(userInputs.hopeDistrict)}</strong> 안의 과거 모집 매물 기준 결과입니다.`;
    }

    if (userInputs.searchBasis === "location") {
        return `<strong>${escapeHtml(userInputs.targetLocation)}</strong> 주변 매물을 자치구 경계 없이 분석한 결과입니다.`;
    }
}

function getRecommendedMessage() {
    if (userInputs.searchBasis === "district") {
        return "선택한 자치구 안에서 역세권 2분/10분, 임대료 데이터, 확률 순으로 정렬했습니다.";
    }

    if (userInputs.searchBasis === "location") {
        return `${getDistrictFilterLabel()}직선 ${LOCATION_SEARCH_RADIUS_KM}km 이내 매물을 거리, 역세권, 확률 순으로 정렬했습니다.`;
    }
}

function comparePriceThenProbability(a, b) {
    return comparePrice(a, b) || b.calculatedProb - a.calculatedProb;
}

function comparePrice(a, b) {
    return normalizedNumber(a.totalCost) - normalizedNumber(b.totalCost);
}

function compareDistance(a, b) {
    return normalizedNumber(a.distance_km) - normalizedNumber(b.distance_km);
}

function getTotalCost(item) {
    if (!Number.isFinite(item.deposit) && !Number.isFinite(item.rent)) return Number.NaN;
    return (Number.isFinite(item.deposit) ? item.deposit : 0) + (Number.isFinite(item.rent) ? item.rent * 100 : 0);
}

function renderHouseList(houses = processedHouses) {
    const container = document.getElementById("prob-house-container");
    container.innerHTML = "";

    if (houses.length === 0) {
        const emptyMessage = userInputs.searchBasis === "location"
            ? `직선 ${LOCATION_SEARCH_RADIUS_KM}km 이내에서 선택한 조건에 맞는 매물이 없습니다.`
            : "선택한 조건에 맞는 매물이 없습니다.";
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-house-circle-exclamation"></i>
                ${emptyMessage}
            </div>`;
        return;
    }

    houses.forEach((house, index) => {
        const pyung = formatPyung(house);
        const traffic = Number.isFinite(house.traffic) ? `도보 약 ${Math.round(house.traffic)}분` : "도보 정보 없음";
        const address = house.address || `${house.district} 주소 미상`;
        const distance = Number.isFinite(house.distance_km) ? ` · 직선 ${house.distance_km}km` : "";
        const price = formatPrice(house);

        container.insertAdjacentHTML(
            "beforeend",
            `
            <div class="house-card" data-house-index="${index}">
                <div class="house-badge-container">
                    <div class="house-prob-badge ${house.signalClass}">${house.signalIcon} ${house.calculatedProb}%</div>
                </div>
                <div class="house-name">${escapeHtml(house.housing_name)}</div>
                <div class="house-info"><i class="fa-solid fa-map-location-dot"></i> ${escapeHtml(address)}</div>
                <div class="house-info"><i class="fa-solid fa-train"></i> ${traffic}${distance}</div>
                <div class="house-price">${escapeHtml(house.district)} · ${pyung} · ${price}</div>
                <div class="tag-group">
                    <span class="tag primary">과거 당첨 ${escapeHtml(house.cutoff_rank)} ${escapeHtml(house.cutoff_score)}</span>
                    <span class="tag">모집시기 ${escapeHtml(house.year)}년 ${escapeHtml(house.half)}반기</span>
                    <span class="tag">${escapeHtml(house.supply_type)}</span>
                </div>
            </div>`
        );
    });

    container.querySelectorAll(".house-card[data-house-index]").forEach((card) => {
        card.addEventListener("click", () => focusMapHouse(Number(card.dataset.houseIndex)));
    });
}

function renderMap(houses) {
    const map = document.getElementById("result-map");
    const empty = document.getElementById("map-empty");
    const mapHouses = houses
        .map((house, index) => ({ house, index }))
        .filter((item) => Number.isFinite(item.house.lat) && Number.isFinite(item.house.lng));
    map.hidden = false;

    if (!window.L) {
        empty.textContent = "지도 라이브러리를 불러오지 못했습니다.";
        empty.hidden = false;
        return;
    }

    ensureLeafletMap();
    clearLeafletMarkers();

    const bounds = [];
    mapHouses.forEach(({ house, index }) => {
        const marker = L.marker([house.lat, house.lng], {
            icon: createLeafletIcon(house.signalColor),
            title: `${house.housing_name} · ${house.district}`,
        });
        marker.bindPopup(getHousePopupHtml(house, index));
        marker.on("click", () => highlightHouseCard(index));
        marker.addTo(leafletMap);
        leafletMarkers[index] = marker;
        bounds.push([house.lat, house.lng]);
    });

    if (targetPoint && Number.isFinite(targetPoint.lat) && Number.isFinite(targetPoint.lng)) {
        const targetMarker = L.marker([targetPoint.lat, targetPoint.lng], {
            icon: createLeafletIcon("target"),
            title: targetPoint.name || userInputs.targetLocation,
            zIndexOffset: 1000,
        });
        targetMarker.bindPopup(`<strong>${escapeHtml(targetPoint.name || userInputs.targetLocation)}</strong><br>입력한 특정 위치`);
        targetMarker.addTo(leafletMap);
        leafletMarkers.push(targetMarker);
        bounds.push([targetPoint.lat, targetPoint.lng]);
    }

    if (bounds.length === 0) {
        empty.textContent = "표시할 좌표가 없습니다.";
        empty.hidden = false;
        return;
    }

    empty.hidden = true;
    setTimeout(() => {
        leafletMap.invalidateSize();
        if (bounds.length === 1) {
            leafletMap.setView(bounds[0], userInputs.searchBasis === "location" ? 15 : 14);
        } else {
            leafletMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
        }
    }, 0);
}

function ensureLeafletMap() {
    if (leafletMap) return;

    leafletMap = L.map("leaflet-map", {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
    }).addTo(leafletMap);
}

function clearLeafletMarkers() {
    leafletMarkers.forEach((marker) => {
        if (marker) marker.remove();
    });
    leafletMarkers = [];
}

function createLeafletIcon(color) {
    const text = color === "target" ? "현" : "";
    return L.divIcon({
        className: "",
        html: `<div class="map-marker marker-${color}">${text}</div>`,
        iconSize: color === "target" ? [24, 24] : [16, 16],
        iconAnchor: color === "target" ? [12, 12] : [8, 8],
        popupAnchor: [0, -10],
    });
}

function getHousePopupHtml(house, index) {
    const distance = Number.isFinite(house.distance_km) ? `<br>직선 ${house.distance_km}km` : "";
    return `
        <strong>${escapeHtml(house.housing_name)}</strong><br>
        ${escapeHtml(house.district)} · ${house.calculatedProb}%${distance}<br>
        <button class="popup-focus-btn" type="button" onclick="window.focusHouseFromMap(${index})">목록에서 보기</button>
    `;
}

function focusMapHouse(index) {
    const house = visibleHouses[index];
    const marker = leafletMarkers[index];
    if (!leafletMap || !house || !marker || !Number.isFinite(house.lat) || !Number.isFinite(house.lng)) return;

    leafletMap.setView([house.lat, house.lng], Math.max(leafletMap.getZoom(), 16));
    marker.openPopup();
    highlightHouseCard(index);
}

function highlightHouseCard(index) {
    document.querySelectorAll(".house-card.map-selected").forEach((card) => {
        card.classList.remove("map-selected");
    });

    const card = document.querySelector(`.house-card[data-house-index="${index}"]`);
    if (!card) return;

    card.classList.add("map-selected");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

window.focusHouseFromMap = highlightHouseCard;

function normalizePoint(point) {
    if (!point) return null;

    return {
        ...point,
        lat: toFiniteNumber(point.lat),
        lng: toFiniteNumber(point.lng),
    };
}

function toFiniteNumber(value) {
    if (Number.isFinite(value)) return value;
    if (value === null || value === undefined || value === "") return Number.NaN;

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizedNumber(value) {
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function formatPyung(house) {
    if (!Number.isFinite(house.pyung)) {
        return "면적 확인 필요";
    }

    const value = `${Math.round(house.pyung)}㎡`;
    return house.pyung_source === "same_listing" ? `${value} 확인값` : value;
}

function formatPrice(house) {
    if (!Number.isFinite(house.deposit) && !Number.isFinite(house.rent)) {
        return "임대료 정보 없음";
    }

    const deposit = Number.isFinite(house.deposit) ? `보증금 ${Math.round(house.deposit)}만` : "보증금 미상";
    const rent = Number.isFinite(house.rent) ? `월세 ${Math.round(house.rent)}만` : "월세 미상";
    return `${deposit} / ${rent}`;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
