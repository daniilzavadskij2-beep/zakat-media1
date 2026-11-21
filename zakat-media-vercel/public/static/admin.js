/* Скрипты админ-панели: загрузка обложки и подтверждение удаления. */
(function () {
  document.addEventListener("submit", function (e) {
    var msg = e.target.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  var input = document.getElementById("cover-file");
  if (!input) return;
  var path = document.getElementById("cover-path");
  var preview = document.getElementById("cover-preview");
  var note = document.getElementById("cover-msg");

  input.addEventListener("change", function () {
    var file = input.files[0];
    if (!file) return;
    if (file.size > 600 * 1024) { note.textContent = "Файл больше 600 КБ. Уменьшите картинку."; return; }
    note.textContent = "Загружаем…";
    fetch("/admin/upload", { method: "POST", headers: { "X-CSRF-Token": input.getAttribute("data-csrf") }, body: file })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { note.textContent = res.body.error || "Не удалось загрузить."; return; }
        path.value = res.body.path;
        preview.src = res.body.path;
        preview.hidden = false;
        note.textContent = "Загружено. Нажмите «Опубликовать» или «Сохранить черновик».";
      })
      .catch(function () { note.textContent = "Ошибка сети."; });
  });
})();
