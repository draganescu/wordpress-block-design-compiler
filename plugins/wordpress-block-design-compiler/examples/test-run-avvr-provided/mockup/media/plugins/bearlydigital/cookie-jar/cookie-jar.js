function $68d45347f877319f$var$setupCookieJar() {
    // Find UI buttons
    const noneButton = document.querySelector('[data-role="cookie-jar-none"]');
    const allButton = document.querySelector('[data-role="cookie-jar-all"]');
    const selectionButton = document.querySelector('[data-role="cookie-jar-selection"]');
    // Add listeners
    noneButton?.addEventListener("click", $68d45347f877319f$var$cookieJarNone);
    allButton?.addEventListener("click", $68d45347f877319f$var$cookieJarAll);
    selectionButton?.addEventListener("click", $68d45347f877319f$var$cookieJarSelection);
}
async function $68d45347f877319f$var$cookieJarNone() {
    await $68d45347f877319f$var$apiPost({
        accept: "none"
    });
}
async function $68d45347f877319f$var$cookieJarAll() {
    await $68d45347f877319f$var$apiPost({
        accept: "all"
    });
}
async function $68d45347f877319f$var$cookieJarSelection() {
    let selection = [];
    for (const option of document.querySelectorAll('[data-role="cookie-jar-option"]'))if (option.checked) selection.push(option.name);
    await $68d45347f877319f$var$apiPost({
        accept: "selection",
        selection: selection
    });
}
async function $68d45347f877319f$var$apiPost(payload) {
    const response = await fetch(window.cookieJarHost + "/cookie-jar", {
        method: "post",
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.snippet) {
        const fragment = document.createRange().createContextualFragment(data.snippet);
        document.body.appendChild(fragment);
        document.dispatchEvent(new Event("DOMContentLoaded"));
    }
    document.querySelector('[data-role="cookie-jar-pop-up"]')?.remove();
}
async function $68d45347f877319f$var$injectCode() {}
document.addEventListener("DOMContentLoaded", (e)=>{
    $68d45347f877319f$var$setupCookieJar();
});


//# sourceMappingURL=cookie-jar.js.map
