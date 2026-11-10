declare const electronAPI: {
  openFile: () => Promise<{ fileName: string, data: string } | null>;
  exportPdf: (defaultFilename: string) => Promise<{ success: boolean, canceled?: boolean, filePath?: string, error?: string }>;
  showError: (title: string, message: string) => Promise<void>; // Ajout ici
};

declare const Plotly: any;

interface SpectroPoint { wl: number; abs: number; smoothAbs?: number; tangent?: number; }

const CSV_SKIP_ROWS = 16;
const SMOOTH_GAUSSIAN_SIGMA = 3;
const INF_POINT_LEFT_LLOW = 353;
const INF_POINT_LEFT_LHIGH = 473;
const INF_POINT_RIGHT_LLOW = 479;
const INF_POINT_RIGHT_LHIGH = 550;
const CHECK_LEFT = 350;
const CHECK_RIGHT = 750;
const HB_LAMBDA_MIN = 410;
const HB_LAMBDA_MAX = 418;
const BL_LAMBDA = 476;
const WARNING_LEVEL_OK = 0;
const WARNING_LEVEL_WARN = 1;
const WARNING_LEVEL_STOP = 2;
const RESIDUALS_THRESHOLD_WARNING = 1e-4;
const RESIDUALS_THRESHOLD_ERROR = 1e-3;

// État global pour permettre le recalcul lors du changement auto/manuel sans recharger le fichier
let currentSpectrum: SpectroPoint[] = [];
let currentRawDataExists = false;

// ---- Événements UI ----
document.getElementById('btn-load')?.addEventListener('click', async () => {
  const result = await electronAPI.openFile();
  if (result) {
    document.getElementById('file-name')!.innerText = result.fileName;
    loadAndProcessFile(result.data, result.fileName);
  }
});

document.getElementsByName('calc-mode').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const isManual = (e.target as HTMLInputElement).value === 'manual';
    document.getElementById('manual-inputs')!.style.display = isManual ? 'flex' : 'none';
    if (currentRawDataExists) updateAnalysis();
  });
});

// Synchronisation bidirectionnelle Slider <-> Number Input <-> Boutons +/- <-> Molette
function bindSliderAndNumber(
  rangeId: string, 
  numId: string, 
  decBtnId: string, 
  incBtnId: string, 
  min: number, 
  max: number
) {
  const rangeEl = document.getElementById(rangeId) as HTMLInputElement;
  const numEl = document.getElementById(numId) as HTMLInputElement;
  const decBtn = document.getElementById(decBtnId);
  const incBtn = document.getElementById(incBtnId);

  const updateVal = (newVal: number) => {
    const clamped = Math.max(min, Math.min(max, newVal));
    rangeEl.value = clamped.toString();
    numEl.value = clamped.toString();
    if (currentRawDataExists) updateAnalysis();
  };

  // Glissement du slider
  rangeEl?.addEventListener('input', () => updateVal(parseInt(rangeEl.value, 10)));
  
  // Saisie manuelle dans l'input numérique
  numEl?.addEventListener('change', () => updateVal(parseInt(numEl.value, 10) || min));

  // Clics sur boutons - et +
  decBtn?.addEventListener('click', () => updateVal(parseInt(rangeEl.value, 10) - 1));
  incBtn?.addEventListener('click', () => updateVal(parseInt(rangeEl.value, 10) + 1));

  // Ajustement à la molette au survol du slider ou du champ numérique (pas de 1 nm)
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    updateVal(parseInt(rangeEl.value, 10) + delta);
  };

  rangeEl?.addEventListener('wheel', handleWheel, { passive: false });
  numEl?.addEventListener('wheel', handleWheel, { passive: false });
}

// Initialisation des deux points de tangente
bindSliderAndNumber('manual-left', 'num-left', 'btn-left-dec', 'btn-left-inc', 350, 600);
bindSliderAndNumber('manual-right', 'num-right', 'btn-right-dec', 'btn-right-inc', 400, 750);

document.getElementsByName('scale-mode').forEach(radio => {
  radio.addEventListener('change', () => {
    if (currentRawDataExists) updateAnalysis();
  });
});

document.getElementById('btn-export-pdf')?.addEventListener('click', async () => {
  const opCodeInput = document.getElementById('op-code') as HTMLInputElement;
  const sampleIdInput = document.getElementById('sample-id') as HTMLInputElement;

  const opCode = opCodeInput?.value.trim() || '';
  const sampleId = sampleIdInput?.value.trim() || '';

  // 1. Validation du code opérateur (4 à 6 caractères)
  if (opCode.length < 3 || opCode.length > 6) {
    await electronAPI.showError("Saisie invalide", "Génération impossible : veuillez rentrer votre code opérateur (3 à 6 caractères).");
    return; // Stoppe l'export
  }

  // 2. Validation de l'identifiant (Exactement 9 chiffres)
  if (sampleId.length !== 9 || !/^\d{9}$/.test(sampleId)) {
    await electronAPI.showError("Saisie invalide", "Génération impossible : veuillez rentrer le numéro d'échantillon GLIMS à 9 chiffres.");
    return; // Stoppe l'export
  }
  
  // NOUVEAU : Force le redimensionnement vectoriel de Plotly avant l'impression
  const plotlyDiv = document.getElementById('plotly-div');
  if (plotlyDiv && typeof Plotly !== 'undefined') {
	await Plotly.relayout(plotlyDiv, { 
	  width: 700, 
	  height: 350, 
	  showlegend: false 
	});
  }

  const fileNameEl = document.getElementById('file-name');
  const baseName = fileNameEl && fileNameEl.innerText !== 'Aucun fichier sélectionné' 
    ? fileNameEl.innerText.replace(/\.[^/.]+$/, "") 
    : 'Rapport_LCR';
  
  // Nomme le fichier de sortie en combinant le nom brut et le numéro d'échantillon
  // Génération de la date et de l'heure locale (format YYYYMMDD_HHhMM)
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const timestamp = `${yyyy}${mm}${dd}_${hh}h${min}`;

  // Combinaison du nom de base, du code opérateur et de l'horodatage
  const result = await electronAPI.exportPdf(`${baseName} ${opCode} ${timestamp}.pdf`);
  
  if (plotlyDiv && typeof Plotly !== 'undefined') {
    await Plotly.relayout(plotlyDiv, { autosize: true, showlegend: true });
  }
  
  if (result && !result.success && !result.canceled) {
    await electronAPI.showError("Erreur d'exportation", "Erreur lors de l'enregistrement du PDF : " + result.error);
  }
});

// ---- Fonctions Utilitaires Mathématiques ----

function ksmooth(x: number[], y: number[], bandwidth: number): number[] {
  const smoothed: number[] = [];
  const sigma = bandwidth / 2.355;
  const variance = sigma * sigma;

  for (let i = 0; i < x.length; i++) {
    const targetX = x[i];
    let weightSum = 0;
    let ySum = 0;

    for (let j = 0; j < x.length; j++) {
      const distance = x[j] - targetX;
      if (Math.abs(distance) > 3 * sigma) continue;
      const weight = Math.exp(-(distance * distance) / (2 * variance));
      weightSum += weight;
      ySum += y[j] * weight;
    }
    smoothed.push(weightSum === 0 ? y[i] : ySum / weightSum);
  }
  return smoothed;
}

// Équivalent de approx() en R pour avoir des pas de 1 nm constants
function interpolateTo1nm(rawData: SpectroPoint[]): SpectroPoint[] {
  if (rawData.length === 0) return [];
  const minWl = Math.ceil(rawData[0].wl);
  const maxWl = Math.floor(rawData[rawData.length - 1].wl);
  const interpolated: SpectroPoint[] = [];

  for (let wl = minWl; wl <= maxWl; wl++) {
    const exact = rawData.find(p => p.wl === wl);
    if (exact) {
      interpolated.push({ wl, abs: exact.abs });
    } else {
      const left = [...rawData].reverse().find(p => p.wl < wl);
      const right = rawData.find(p => p.wl > wl);
      if (left && right) {
        const ratio = (wl - left.wl) / (right.wl - left.wl);
        const abs = left.abs + ratio * (right.abs - left.abs);
        interpolated.push({ wl, abs });
      }
    }
  }
  return interpolated;
}

// Parseur TST
function parseTstData(rawData: string): SpectroPoint[] {
  const parts = rawData.split(/\s+/);
  const fileValues = parts.map(p => parseFloat(p));
  let readIndex = 0;
  let lastValidTrace: SpectroPoint[] = [];

  while (readIndex < fileValues.length - 1) {
    const curValue = fileValues[readIndex];
    const nextValue = fileValues[readIndex + 1];
    if (!isNaN(curValue) && !isNaN(nextValue)) {
      if (curValue === 3500 && nextValue !== 7500) {
        let traceValid = true;
        const currentTrace: SpectroPoint[] = [];
        for (let traceIndex = 350; traceIndex <= 750; traceIndex += 2) {
          if (readIndex + 1 >= fileValues.length) { traceValid = false; break; }
          const wl = fileValues[readIndex] / 10;
          const t = fileValues[readIndex + 1];
          if (isNaN(wl) || isNaN(t) || wl !== traceIndex) { traceValid = false; break; }
          
          currentTrace.push({ wl, abs: Math.log10(1 / t) });
          readIndex += 2;
        }
        if (traceValid && currentTrace.length === 201) lastValidTrace = currentTrace;
        continue;
      }
    }
    readIndex++;
  }
  if (lastValidTrace.length === 0) throw new Error("Données .tst invalides.");
  return lastValidTrace;
}


// ---- Logique Principale ----

function loadAndProcessFile(rawData: string, fileName: string) {
  let rawSpectrum: SpectroPoint[] = [];

  try {
    if (fileName.toLowerCase().endsWith('.tst')) {
      rawSpectrum = parseTstData(rawData);
    } else {
      alert("Format non pris en charge.");
      return;
    }
  } catch (error: any) {
    alert(error.message); return;
  }

  rawSpectrum.sort((a, b) => a.wl - b.wl);
  
  // Interpolation à 1nm (approx dans app.R)
  currentSpectrum = interpolateTo1nm(rawSpectrum);

  // Lissage
  const wls = currentSpectrum.map(p => p.wl);
  const rawAbs = currentSpectrum.map(p => p.abs);
  const smoothAbsArray = ksmooth(wls, rawAbs, SMOOTH_GAUSSIAN_SIGMA);
  currentSpectrum.forEach((pt, i) => pt.smoothAbs = smoothAbsArray[i]);

  currentRawDataExists = true;
  updateAnalysis(); // Lance le calcul et l'affichage
}

function updateAnalysis() {
  const mode = (document.querySelector('input[name="calc-mode"]:checked') as HTMLInputElement).value;
  const scaleMode = (document.querySelector('input[name="scale-mode"]:checked') as HTMLInputElement)?.value || 'normal';
  let leftWl = NaN, rightWl = NaN;

  // -- 1. Calcul de la Tangente --
  if (mode === 'auto') {
    let minResiduals = Infinity;
    const leftCandidates = currentSpectrum.filter(p => p.wl >= INF_POINT_LEFT_LLOW && p.wl <= INF_POINT_LEFT_LHIGH);
    const rightCandidates = currentSpectrum.filter(p => p.wl >= INF_POINT_RIGHT_LLOW && p.wl <= INF_POINT_RIGHT_LHIGH);

    for (const leftPt of leftCandidates) {
      for (const rightPt of rightCandidates) {
        if (rightPt.wl <= leftPt.wl) continue;
        const a = (rightPt.smoothAbs! - leftPt.smoothAbs!) / (rightPt.wl - leftPt.wl);
        const b = rightPt.smoothAbs! - a * rightPt.wl;
        let sumResiduals = 0;
        
        for (const pt of currentSpectrum) {
          const tgValue = a * pt.wl + b;
          if (pt.wl >= CHECK_LEFT && pt.wl <= CHECK_RIGHT) {
            const residual = pt.smoothAbs! - tgValue;
            if (residual < 0) sumResiduals += (-residual);
          }
        }

        if (sumResiduals < minResiduals) {
          minResiduals = sumResiduals;
          leftWl = leftPt.wl;
          rightWl = rightPt.wl;
        }
      }
    }
  } else {
    // Mode manuel
    leftWl = parseFloat((document.getElementById('manual-left') as HTMLInputElement).value);
    rightWl = parseFloat((document.getElementById('manual-right') as HTMLInputElement).value);
  }

  // Application de la droite (y = ax + b)
  const ptLeft = currentSpectrum.find(p => p.wl === leftWl);
  const ptRight = currentSpectrum.find(p => p.wl === rightWl);
  
  if (ptLeft && ptRight) {
    const a = (ptRight.smoothAbs! - ptLeft.smoothAbs!) / (ptRight.wl - ptLeft.wl);
    const b = ptRight.smoothAbs! - a * ptRight.wl;
    currentSpectrum.forEach(pt => pt.tangent = a * pt.wl + b);
  }

  // -- 2. Évaluation Clinique et Qualité --
  let warningLevel = WARNING_LEVEL_OK;
  const warningItems: string[] = [];
  
  if (scaleMode === 'zoomed') {
    warningItems.push("Échelle zoomée sélectionnée : réinitialiser l'échelle sur 'Échelle normale' avant toute interprétation et génération du rapport PDF.");
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_STOP);
  }

  // Amélioration : Distinction des absorbances négatives (faiblement vs significativement)
  const minAbs = Math.min(...currentSpectrum.map(p => p.abs));
  const minAbs550 = Math.min(...currentSpectrum.filter(p => p.wl < 550).map(p => p.abs));

  if (minAbs550 < -0.001) {
    warningItems.push("Valeurs d'absorbance significativement négatives (< -0.001) entre 350 et 550nm !");
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_STOP);
  } else if (minAbs550 < 0) {
    warningItems.push("Valeurs d'absorbance faiblement négatives (entre 0 et -0.001) entre 350 et 550nm.");
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_WARN);
  } else if (minAbs < -0.001) {
    warningItems.push("Valeurs d'absorbance significativement négatives (< -0.001) sur le reste du spectre !");
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_WARN);
  } else if (minAbs < 0) {
    warningItems.push("Valeurs d'absorbance faiblement négatives (entre 0 et -0.001).");
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_WARN);
  }

  if (mode !== "auto") {
    warningItems.push("Méthode manuelle choisie: vérifier la cohérence des résultats !");
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_WARN);
  }

  const positiveTangentsWl = currentSpectrum.filter(p => p.tangent! > 0).map(p => p.wl);
  const maxTangentCrossWl = positiveTangentsWl.length > 0 ? Math.max(...positiveTangentsWl) : 0;
  
  if (maxTangentCrossWl < BL_LAMBDA) {
    warningItems.push(`La tangente passe par zéro avant ${BL_LAMBDA}nm !`);
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_WARN);
  }

  const restrictedSpectrum = currentSpectrum.filter(p => p.wl >= INF_POINT_LEFT_LLOW && p.wl <= INF_POINT_RIGHT_LHIGH);
  let sumTotalResiduals = 0;
  for (const pt of restrictedSpectrum) {
    const res = pt.smoothAbs! - pt.tangent!;
    if (res < 0) sumTotalResiduals += (-res);
  }

  if (sumTotalResiduals > RESIDUALS_THRESHOLD_ERROR) {
    warningItems.push(mode === "auto" 
      ? `Impossible de trouver une tangente sans couper la courbe entre ${INF_POINT_LEFT_LLOW} et ${INF_POINT_RIGHT_LHIGH}nm !` 
      : `Les positions choisies sont invalides: la tangente passe au-dessus de la courbe entre ${INF_POINT_LEFT_LLOW} et ${INF_POINT_RIGHT_LHIGH}nm !`);
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_STOP);
  } else if (sumTotalResiduals > RESIDUALS_THRESHOLD_WARNING) {
    warningItems.push(mode === "auto" 
      ? `Impossible de trouver une tangente sans couper la courbe entre ${INF_POINT_LEFT_LLOW} et ${INF_POINT_RIGHT_LHIGH}nm !` 
      : `Les positions choisies sont douteuses: la tangente passe au-dessus de la courbe entre ${INF_POINT_LEFT_LLOW} et ${INF_POINT_RIGHT_LHIGH}nm !`);
    warningLevel = Math.max(warningLevel, WARNING_LEVEL_WARN);
  }

  const hbCandidates = currentSpectrum.filter(p => p.wl >= HB_LAMBDA_MIN && p.wl <= HB_LAMBDA_MAX);
  const hbPt = hbCandidates.reduce((maxPt, currentPt) => 
    (currentPt.smoothAbs! > maxPt.smoothAbs!) ? currentPt : maxPt
  , hbCandidates[0]) || currentSpectrum[0];
  
  const peakHbWl = hbPt.wl; // Longueur d'onde exacte du pic trouvé

  const blPt = currentSpectrum.find(p => p.wl === BL_LAMBDA) || currentSpectrum[0];

  const hbDeltaDo = hbPt.smoothAbs! - hbPt.tangent!;
  const blDeltaDo = blPt.smoothAbs! - blPt.tangent!;

  const hbConcl = hbDeltaDo >= 0.1 ? ">0.1" : (hbDeltaDo >= 0.02 ? ">0.02" : "<0.02");
  const blConcl = blDeltaDo >= 0.007 ? ">0.007" : "<0.007";

  let comConcl = "?";
  if (blConcl === "<0.007") {
    if (hbConcl === ">0.1") {
      comConcl = "C1 : Présence d’hémoglobine en quantité trop importante pouvant masquer la présence de bilirubine. Hémorragie sous-arachnoïdienne non exclue.";
    } else if (hbConcl === ">0.02") {
      comConcl = "C3 : Présence d’hémoglobine en faible quantité mais absence de bilirubine. Pas d’argument en faveur d’une hémorragie sous-arachnoïdienne ou compatible avec une HSA débutante ou une PL traumatique.";
    } else {
      comConcl = "C2 : Examen spectrophotométrique négatif. Absence d’hémoglobine et de bilirubine. Pas d’argument en faveur d’une hémorragie sous-arachnoïdienne.";
    }
  } else {
    if (hbConcl === ">0.1" || hbConcl === ">0.02") {
      comConcl = "C4 : Présence de bilirubine et d’hémoglobine. Résultat compatible avec une hémorragie sous-arachnoïdienne. (Attention: non spécifique).";
    } else {
      comConcl = "Delta DO bilirubine positif! Regarder la protéinorachie et la bilirubinémie plasmatique pour conclure.";
    }
  }

  // -- 3. Mise à jour Interface UI --
  const warningsBox = document.getElementById('warnings-box')!;
  const warningsList = document.getElementById('warnings-list')!;
  const warningsFooter = document.getElementById('warnings-footer')!;
  
  const now = new Date();
  const formattedDate = now.toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const dateEl = document.getElementById('analysis-date');
  if (dateEl) dateEl.innerText = formattedDate;
  
  // Amélioration : Affichage automatique de la recommandation si avertissement
  if (warningItems.length > 0) {
    warningsBox.style.display = 'block';
    warningsBox.className = `warnings-box level-${warningLevel}`;
    warningsList.innerHTML = warningItems.map(w => `<li>${w}</li>`).join('');
	warningsFooter.innerHTML = "<span style='font-size: 1.2em; margin-right: 5px;'>⚠️</span> L'analyse spectrale doit être refaite après correction des éventuels facteurs interférents (recentrifugation, changement de la cuve et vérification des poussières ou imperfections, chauffage de la lampe du spectrophotomètre > 15 minutes...) avant toute interprétation.";
  } else {
    warningsBox.style.display = 'none';
  }

  // Amélioration : Ajout des seuils descriptifs (<0.02, etc.) à côté des valeurs
  document.getElementById('noa-title')!.innerText = `NOA (net oxyhemoglobin absorbance - ${peakHbWl} nm)`;
  
  document.getElementById('val-noa')!.innerHTML = `${hbDeltaDo.toFixed(4)} <span style="font-size: 1.1rem; font-weight: normal; color: #6b7280;">(${hbConcl})</span>`;
  document.getElementById('val-nba')!.innerHTML = `${blDeltaDo.toFixed(4)} <span style="font-size: 1.1rem; font-weight: normal; color: #6b7280;">(${blConcl})</span>`;

  const conclusionEl = document.getElementById('val-conclusion')!;
  conclusionEl.innerText = comConcl;
  if (blDeltaDo > 0.007) {
    conclusionEl.style.backgroundColor = '#fee2e2'; conclusionEl.style.color = '#991b1b';
  } else {
    conclusionEl.style.backgroundColor = '#dcfce7'; conclusionEl.style.color = '#166534';
  }
  
  // Évaluation du point gauche
  let leftStatus = "HORS LIMITE", leftColor = "#dc2626"; // Rouge
  if (leftWl >= 350 && leftWl <= 400) {
    leftStatus = "OK";
    leftColor = "#166534"; // Vert foncé
  } else if (leftWl > 400 && leftWl <= 473) {
    leftStatus = "LIMITE";
    leftColor = "#d97706"; // Jaune moutarde (lisible sur fond clair)
  }

  // Évaluation du point droit
  let rightStatus = "HORS LIMITE", rightColor = "#dc2626"; // Rouge
  if (rightWl >= 450 && rightWl <= 550) {
    rightStatus = "OK";
    rightColor = "#166534"; // Vert foncé
  }

  // Affichage avec le statut intégré
  document.getElementById('val-tangent-pts')!.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; padding-left: 10px; padding-right: 10px;">
      <span>&bull; gauche : ${leftWl} nm</span>
      <strong style="color: ${leftColor};">${leftStatus}</strong>
    </div>
    <div style="display: flex; justify-content: space-between; padding-left: 10px; padding-right: 10px;">
      <span>&bull; droite : ${rightWl} nm</span>
      <strong style="color: ${rightColor};">${rightStatus}</strong>
    </div>
  `;

  // -- 4. Tracé Plotly --
  
  // 1. Filtrer les points du spectre où la tangente est positive (y >= 0)
  const positiveTangentPoints = currentSpectrum.filter(p => p.tangent !== undefined && p.tangent >= 0);
  
  let tangentX = positiveTangentPoints.map(p => p.wl);
  let tangentY = positiveTangentPoints.map(p => p.tangent!);

  // 2. Calculer l'intersection exacte avec y = 0 pour que la ligne touche l'axe proprement
  if (ptLeft && ptRight) {
    const a = (ptRight.smoothAbs! - ptLeft.smoothAbs!) / (rightWl - leftWl);
    const b = ptRight.smoothAbs! - a * rightWl;
    
    if (a !== 0) {
      const zeroWl = -b / a; // Longueur d'onde où la tangente croise y = 0
      
      if (zeroWl >= 350 && zeroWl <= 750) {
        if (a > 0) {
          // Si la pente est positive, la tangente passe sous 0 à gauche
          tangentX.unshift(zeroWl);
          tangentY.unshift(0);
        } else {
          // Si la pente est négative, la tangente passe sous 0 à droite
          tangentX.push(zeroWl);
          tangentY.push(0);
        }
      }
    }
  }

  // 3. Déclaration de la trace avec les données tronquées
  const traceRaw = { x: currentSpectrum.map(p => p.wl), y: currentSpectrum.map(p => p.abs), mode: 'lines', name: 'Brut', line: { color: 'lightgray' } };
  const traceSmooth = { x: currentSpectrum.map(p => p.wl), y: currentSpectrum.map(p => p.smoothAbs), mode: 'lines', name: 'Lissé', line: { color: 'black' } };
  
  const traceTangent = { 
    x: tangentX, 
    y: tangentY, 
    mode: 'lines', 
    name: 'Tangente', 
    line: { color: 'red' } 
  };  
  const traceTangentPoints = {
      x: [leftWl, rightWl],
      y: [ptLeft?.smoothAbs, ptRight?.smoothAbs],
      mode: 'markers', name: 'Points Tangente', marker: { color: 'red', size: 8 }
  };

  // Amélioration : Adaptation de l'échelle d'absorbance (Y-axis)
  const maxAbs = Math.max(...currentSpectrum.map(p => p.abs));
  const yAxisMax = maxAbs > 0.1 ? maxAbs : 0.1;
  
  const yaxisConfig = scaleMode === 'zoomed' 
    ? { title: 'Absorbance', autorange: true }
    : { title: 'Absorbance', range: [0, yAxisMax] };

  const layout = {
    title: 'Spectre d\'absorption',
    xaxis: { title: 'Longueur d\'onde (nm)', range: [350, 750] },
    yaxis: yaxisConfig,
    margin: { t: 40, l: 50, r: 20, b: 40 },
    shapes: [
        { type: 'line', x0: peakHbWl,  y0: 0, x1: peakHbWl,  y1: hbPt?.abs || 0.1, line: { color: 'black', dash: 'dot', width: 2 } },
        { type: 'line', x0: BL_LAMBDA, y0: 0, x1: BL_LAMBDA, y1: blPt?.abs || 0.1, line: { color: 'black', dash: 'dot', width: 2 } }
    ]
  };

  Plotly.newPlot('plotly-div', [traceRaw, traceSmooth, traceTangent, traceTangentPoints], layout, { responsive: true });

  // Afficher le bouton PDF une fois l'analyse terminée
  const btnExport = document.getElementById('btn-export-pdf');
  if (btnExport) btnExport.style.display = 'block';
}
