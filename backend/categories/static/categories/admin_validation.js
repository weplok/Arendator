(function () {
  "use strict";

  const errorMessage =
    "Характеристика с таким названием уже есть в категории-предке или этой форме.";

  function normalizeName(value) {
    return value.trim().toLocaleLowerCase("ru-RU");
  }

  function selectedCategoryField() {
    return document.querySelector("#id_category") || document.querySelector("#id_parent");
  }

  function characteristicNameInputs() {
    if (document.querySelector("#id_category")) {
      const standaloneName = document.querySelector("#id_name");
      return standaloneName ? [standaloneName] : [];
    }
    return Array.from(
      document.querySelectorAll(
        'input[name^="characteristics-"][name$="-name"]',
      ),
    );
  }

  function isDeletedInline(input) {
    const prefix = input.name.slice(0, -"name".length);
    const deleteInput = document.querySelector(`[name="${prefix}DELETE"]`);
    return deleteInput instanceof HTMLInputElement && deleteInput.checked;
  }

  function inheritedNames(categoryField) {
    try {
      const mapping = JSON.parse(
        categoryField.dataset.inheritedCharacteristicNames || "{}",
      );
      return mapping[categoryField.value] || [];
    } catch {
      return [];
    }
  }

  function validateCharacteristicNames() {
    const categoryField = selectedCategoryField();
    if (!(categoryField instanceof HTMLSelectElement)) return;
    const usedNames = new Set(
      inheritedNames(categoryField).map((name) => normalizeName(String(name))),
    );
    characteristicNameInputs().forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      input.setCustomValidity("");
      if (isDeletedInline(input)) return;
      const name = normalizeName(input.value);
      if (!name) return;
      if (usedNames.has(name)) {
        input.setCustomValidity(errorMessage);
        return;
      }
      usedNames.add(name);
    });
  }

  function setupValidation() {
    validateCharacteristicNames();
    document.addEventListener("input", validateCharacteristicNames);
    document.addEventListener("change", validateCharacteristicNames);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupValidation);
  } else {
    setupValidation();
  }
})();
