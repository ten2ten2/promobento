# CI-only named profile: permit Chromium's nested user namespace without disabling the runner's global restriction.
# Chromium guidance: https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
abi <abi/4.0>,
include <tunables/global>
profile promobento-browser-test flags=(unconfined) {
  userns,
}
