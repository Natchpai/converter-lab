'use strict';

/* ================= start ================= */
buildParams(PARAMS, $('#paramList'));
buildParams(NONIDEAL, $('#nonIdealList'));
syncAllParams();
buildChannels();
buildTimeControls();
buildSchem();
buildControlUI();
buildSpecUI();
buildCompUI();
const query = new URLSearchParams(location.search);
if (['pcmc', 'acmc'].includes(query.get('mode'))) $(`#ctlMode button[data-m="${query.get('mode')}"]`).click();
if (['design', 'losses', 'control'].includes(query.get('page'))) setPage(query.get('page'), true);
showTab(savedTab());
applySplits();
updateSegs();
updateNonIdealUI();
compute();
resize();
renderAll();
if (/selftest/.test(location.search)) { $('.about').open = true; selfTest(); }
else if (query.has('uitest')) uiTest();
