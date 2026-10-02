#!/usr/bin/env python3
"""Generates Contrail.xcodeproj (Xcode 16+/26 format, objectVersion 77) with file-system
synchronized groups, so every source file under App/, Widgets/, Watch/, WatchWidgets/ is picked up
automatically. Re-run after changing targets or build settings:  python3 Tools/gen_xcodeproj.py
"""
import hashlib, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BUNDLE = "info.everyapp.contrail"


def oid(name):
    return hashlib.md5(name.encode()).hexdigest()[:24].upper()


def q(v):
    """Quotes a pbxproj scalar when needed."""
    if isinstance(v, list):
        return "(\n" + "".join(f"\t\t\t\t\t{q(x)},\n" for x in v) + "\t\t\t\t)"
    s = str(v)
    if s and all(c.isalnum() or c in "._/" for c in s) and not s.startswith("."):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def settings_block(d, indent="\t\t\t\t"):
    out = ""
    for k in sorted(d):
        out += f"{indent}{k} = {q(d[k])};\n"
    return out


PROJECT = oid("project")
MAIN_GROUP = oid("maingroup")
PRODUCTS_GROUP = oid("products")
PKG_REF = oid("pkg:ContrailKit")

COMMON_TARGET = {
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "MARKETING_VERSION": "1.0",
    "DEVELOPMENT_TEAM": "",
    "GENERATE_INFOPLIST_FILE": "YES",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "SWIFT_VERSION": "6.0",
    "ENABLE_PREVIEWS": "YES",
    "INFOPLIST_KEY_CFBundleDisplayName": "Contrail",
}

targets = [
    dict(
        name="Contrail", folder="App", product="Contrail.app", ptype="com.apple.product-type.application",
        ftype="wrapper.application",
        settings={
            **COMMON_TARGET,
            "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
            "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
            "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS": "YES",
            "CODE_SIGN_ENTITLEMENTS": "Config/Contrail.entitlements",
            "INFOPLIST_FILE": "Config/Contrail-Info.plist",
            "INFOPLIST_KEY_LSApplicationCategoryType": "public.app-category.navigation",
            "INFOPLIST_KEY_NSSupportsLiveActivities": "YES",
            "INFOPLIST_KEY_NSLocationWhenInUseUsageDescription":
                "Contrail shows your position on the map to find nearby airports and traffic.",
            "INFOPLIST_KEY_UIApplicationSceneManifest_Generation": "YES",
            "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES",
            "INFOPLIST_KEY_UILaunchScreen_Generation": "YES",
            "INFOPLIST_KEY_UIStatusBarStyle": "UIStatusBarStyleLightContent",
            "INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad":
                "UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown",
            "INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone":
                "UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight UIInterfaceOrientationPortrait",
            "IPHONEOS_DEPLOYMENT_TARGET": "18.0",
            "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"],
            "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE,
            "SDKROOT": "iphoneos",
            "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
            "SUPPORTS_MACCATALYST": "NO",
            "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "YES",
            "SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD": "NO",
            "SWIFT_DEFAULT_ACTOR_ISOLATION": "MainActor",
            "SWIFT_APPROACHABLE_CONCURRENCY": "YES",
            "TARGETED_DEVICE_FAMILY": "1,2",
        },
        embeds_ext=["ContrailWidgets"], embeds_watch=["ContrailWatch"],
    ),
    dict(
        name="ContrailWidgets", folder="Widgets", product="ContrailWidgets.appex",
        ptype="com.apple.product-type.app-extension", ftype='"wrapper.app-extension"',
        settings={
            **COMMON_TARGET,
            "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
            "ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME": "WidgetBackground",
            "CODE_SIGN_ENTITLEMENTS": "Config/Widgets.entitlements",
            "INFOPLIST_FILE": "Config/Widgets-Info.plist",
            "IPHONEOS_DEPLOYMENT_TARGET": "18.0",
            "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"],
            "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE + ".widgets",
            "SDKROOT": "iphoneos",
            "SKIP_INSTALL": "YES",
            "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
            "SUPPORTS_MACCATALYST": "NO",
            "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "YES",
            "TARGETED_DEVICE_FAMILY": "1,2",
        },
    ),
    dict(
        name="ContrailWatch", folder="Watch", product="ContrailWatch.app", ptype="com.apple.product-type.application",
        ftype="wrapper.application",
        settings={
            **COMMON_TARGET,
            "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
            "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
            "CODE_SIGN_ENTITLEMENTS": "Config/Watch.entitlements",
            "INFOPLIST_KEY_UISupportedInterfaceOrientations": "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown",
            "INFOPLIST_KEY_WKCompanionAppBundleIdentifier": BUNDLE,
            "INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp": "NO",
            "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"],
            "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE + ".watchkitapp",
            "SDKROOT": "watchos",
            "SKIP_INSTALL": "YES",
            "SWIFT_DEFAULT_ACTOR_ISOLATION": "MainActor",
            "SWIFT_APPROACHABLE_CONCURRENCY": "YES",
            "TARGETED_DEVICE_FAMILY": "4",
            "WATCHOS_DEPLOYMENT_TARGET": "11.0",
        },
        embeds_ext=["ContrailWatchWidgets"],
    ),
    dict(
        name="ContrailWatchWidgets", folder="WatchWidgets", product="ContrailWatchWidgets.appex",
        ptype="com.apple.product-type.app-extension", ftype='"wrapper.app-extension"',
        settings={
            **COMMON_TARGET,
            "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
            "ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME": "WidgetBackground",
            "CODE_SIGN_ENTITLEMENTS": "Config/WatchWidgets.entitlements",
            "INFOPLIST_FILE": "Config/WatchWidgets-Info.plist",
            "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"],
            "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE + ".watchkitapp.widgets",
            "SDKROOT": "watchos",
            "SKIP_INSTALL": "YES",
            "TARGETED_DEVICE_FAMILY": "4",
            "WATCHOS_DEPLOYMENT_TARGET": "11.0",
        },
    ),
]
PRODUCTS = ["VatCore", "ContrailShared"]

for t in targets:
    n = t["name"]
    t["id"] = oid("target:" + n)
    t["product_ref"] = oid("product:" + n)
    t["group"] = oid("group:" + t["folder"])
    t["config_list"] = oid("configlist:" + n)
    t["debug"] = oid("debug:" + n)
    t["release"] = oid("release:" + n)
    t["phase_sources"] = oid("sources:" + n)
    t["phase_frameworks"] = oid("frameworks:" + n)
    t["phase_resources"] = oid("resources:" + n)
    t["pkgdeps"] = {p: oid(f"pkgdep:{n}:{p}") for p in PRODUCTS}
    t["pkgfiles"] = {p: oid(f"pkgfile:{n}:{p}") for p in PRODUCTS}

by_name = {t["name"]: t for t in targets}
extra_groups = ["Config"]
PKG_FILE = oid("file:ContrailKit")


def embedfile(t, e):
    return oid("embedfile:" + t["name"] + ":" + e)


def depid(t, e):
    return oid("dep:" + t["name"] + ":" + e)


def proxyid(t, e):
    return oid("proxy:" + t["name"] + ":" + e)


o = []
o.append("// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 77;\n\tobjects = {\n")

# PBXBuildFile
o.append("\n/* Begin PBXBuildFile section */\n")
for t in targets:
    for p in PRODUCTS:
        o.append(f"\t\t{t['pkgfiles'][p]} /* {p} in Frameworks */ = {{isa = PBXBuildFile; productRef = {t['pkgdeps'][p]} /* {p} */; }};\n")
    for e in t.get("embeds_ext", []) + t.get("embeds_watch", []):
        bf = embedfile(t, e)
        o.append(f"\t\t{bf} /* {by_name[e]['product']} in Embed */ = {{isa = PBXBuildFile; fileRef = {by_name[e]['product_ref']} /* {by_name[e]['product']} */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};\n")
o.append("/* End PBXBuildFile section */\n")

# PBXContainerItemProxy
o.append("\n/* Begin PBXContainerItemProxy section */\n")
for t in targets:
    for e in t.get("embeds_ext", []) + t.get("embeds_watch", []):
        px = proxyid(t, e)
        o.append(f"\t\t{px} /* PBXContainerItemProxy */ = {{\n\t\t\tisa = PBXContainerItemProxy;\n\t\t\tcontainerPortal = {PROJECT} /* Project object */;\n\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = {by_name[e]['id']};\n\t\t\tremoteInfo = {e};\n\t\t}};\n")
o.append("/* End PBXContainerItemProxy section */\n")

# PBXCopyFilesBuildPhase
o.append("\n/* Begin PBXCopyFilesBuildPhase section */\n")
for t in targets:
    if t.get("embeds_ext"):
        ph = oid(f"embedext:{t['name']}")
        files = "".join(f"\t\t\t\t{embedfile(t, e)} /* {by_name[e]['product']} in Embed Foundation Extensions */,\n" for e in t["embeds_ext"])
        o.append(f"\t\t{ph} /* Embed Foundation Extensions */ = {{\n\t\t\tisa = PBXCopyFilesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tdstPath = \"\";\n\t\t\tdstSubfolderSpec = 13;\n\t\t\tfiles = (\n{files}\t\t\t);\n\t\t\tname = \"Embed Foundation Extensions\";\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
    if t.get("embeds_watch"):
        ph = oid(f"embedwatch:{t['name']}")
        files = "".join(f"\t\t\t\t{embedfile(t, e)} /* {by_name[e]['product']} in Embed Watch Content */,\n" for e in t["embeds_watch"])
        o.append(f"\t\t{ph} /* Embed Watch Content */ = {{\n\t\t\tisa = PBXCopyFilesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tdstPath = \"$(CONTENTS_FOLDER_PATH)/Watch\";\n\t\t\tdstSubfolderSpec = 16;\n\t\t\tfiles = (\n{files}\t\t\t);\n\t\t\tname = \"Embed Watch Content\";\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
o.append("/* End PBXCopyFilesBuildPhase section */\n")

# PBXFileReference
o.append("\n/* Begin PBXFileReference section */\n")
for t in targets:
    o.append(f"\t\t{t['product_ref']} /* {t['product']} */ = {{isa = PBXFileReference; explicitFileType = {t['ftype']}; includeInIndex = 0; path = {t['product']}; sourceTree = BUILT_PRODUCTS_DIR; }};\n")
o.append(f"\t\t{PKG_FILE} /* ContrailKit */ = {{isa = PBXFileReference; lastKnownFileType = wrapper; path = ContrailKit; sourceTree = \"<group>\"; }};\n")
o.append("/* End PBXFileReference section */\n")

# PBXFileSystemSynchronizedRootGroup
o.append("\n/* Begin PBXFileSystemSynchronizedRootGroup section */\n")
for t in targets:
    o.append(f"\t\t{t['group']} /* {t['folder']} */ = {{\n\t\t\tisa = PBXFileSystemSynchronizedRootGroup;\n\t\t\tpath = {t['folder']};\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
for g in extra_groups:
    o.append(f"\t\t{oid('group:' + g)} /* {g} */ = {{\n\t\t\tisa = PBXFileSystemSynchronizedRootGroup;\n\t\t\tpath = {g};\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
o.append("/* End PBXFileSystemSynchronizedRootGroup section */\n")

# PBXFrameworksBuildPhase
o.append("\n/* Begin PBXFrameworksBuildPhase section */\n")
for t in targets:
    files = "".join(f"\t\t\t\t{t['pkgfiles'][p]} /* {p} in Frameworks */,\n" for p in PRODUCTS)
    o.append(f"\t\t{t['phase_frameworks']} /* Frameworks */ = {{\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n{files}\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
o.append("/* End PBXFrameworksBuildPhase section */\n")

# PBXGroup
o.append("\n/* Begin PBXGroup section */\n")
children = "".join(f"\t\t\t\t{t['group']} /* {t['folder']} */,\n" for t in targets)
children += "".join(f"\t\t\t\t{oid('group:' + g)} /* {g} */,\n" for g in extra_groups)
children += f"\t\t\t\t{PKG_FILE} /* ContrailKit */,\n"
o.append(f"\t\t{MAIN_GROUP} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n{children}\t\t\t\t{PRODUCTS_GROUP} /* Products */,\n\t\t\t);\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
prods = "".join(f"\t\t\t\t{t['product_ref']} /* {t['product']} */,\n" for t in targets)
o.append(f"\t\t{PRODUCTS_GROUP} /* Products */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n{prods}\t\t\t);\n\t\t\tname = Products;\n\t\t\tsourceTree = \"<group>\";\n\t\t}};\n")
o.append("/* End PBXGroup section */\n")

# PBXNativeTarget
o.append("\n/* Begin PBXNativeTarget section */\n")
for t in targets:
    phases = [f"{t['phase_sources']} /* Sources */", f"{t['phase_frameworks']} /* Frameworks */", f"{t['phase_resources']} /* Resources */"]
    if t.get("embeds_ext"):
        phases.append(f"{oid('embedext:' + t['name'])} /* Embed Foundation Extensions */")
    if t.get("embeds_watch"):
        phases.append(f"{oid('embedwatch:' + t['name'])} /* Embed Watch Content */")
    deps = [f"{depid(t, e)} /* PBXTargetDependency */" for e in t.get("embeds_ext", []) + t.get("embeds_watch", [])]
    pk = "".join(f"\t\t\t\t{t['pkgdeps'][p]} /* {p} */,\n" for p in PRODUCTS)
    o.append(
        f"\t\t{t['id']} /* {t['name']} */ = {{\n\t\t\tisa = PBXNativeTarget;\n"
        f"\t\t\tbuildConfigurationList = {t['config_list']} /* Build configuration list for PBXNativeTarget \"{t['name']}\" */;\n"
        f"\t\t\tbuildPhases = (\n" + "".join(f"\t\t\t\t{p},\n" for p in phases) + "\t\t\t);\n"
        f"\t\t\tbuildRules = (\n\t\t\t);\n"
        f"\t\t\tdependencies = (\n" + "".join(f"\t\t\t\t{d},\n" for d in deps) + "\t\t\t);\n"
        f"\t\t\tfileSystemSynchronizedGroups = (\n\t\t\t\t{t['group']} /* {t['folder']} */,\n\t\t\t);\n"
        f"\t\t\tname = {t['name']};\n"
        f"\t\t\tpackageProductDependencies = (\n{pk}\t\t\t);\n"
        f"\t\t\tproductName = {t['name']};\n"
        f"\t\t\tproductReference = {t['product_ref']} /* {t['product']} */;\n"
        f"\t\t\tproductType = \"{t['ptype']}\";\n\t\t}};\n"
    )
o.append("/* End PBXNativeTarget section */\n")

# PBXProject
o.append("\n/* Begin PBXProject section */\n")
ta = "".join(f"\t\t\t\t\t{t['id']} = {{\n\t\t\t\t\t\tCreatedOnToolsVersion = 26.0;\n\t\t\t\t\t}};\n" for t in targets)
tl = "".join(f"\t\t\t\t{t['id']} /* {t['name']} */,\n" for t in targets)
o.append(
    f"\t\t{PROJECT} /* Project object */ = {{\n\t\t\tisa = PBXProject;\n\t\t\tattributes = {{\n"
    f"\t\t\t\tBuildIndependentTargetsInParallel = 1;\n\t\t\t\tLastSwiftUpdateCheck = 2600;\n\t\t\t\tLastUpgradeCheck = 2600;\n"
    f"\t\t\t\tTargetAttributes = {{\n{ta}\t\t\t\t}};\n\t\t\t}};\n"
    f"\t\t\tbuildConfigurationList = {oid('configlist:project')} /* Build configuration list for PBXProject \"Contrail\" */;\n"
    f"\t\t\tdevelopmentRegion = en;\n\t\t\thasScannedForEncodings = 0;\n"
    f"\t\t\tknownRegions = (\n\t\t\t\ten,\n\t\t\t\tit,\n\t\t\t\tBase,\n\t\t\t);\n"
    f"\t\t\tmainGroup = {MAIN_GROUP};\n\t\t\tminimizedProjectReferenceProxies = 1;\n"
    f"\t\t\tpackageReferences = (\n\t\t\t\t{PKG_REF} /* XCLocalSwiftPackageReference \"ContrailKit\" */,\n\t\t\t);\n"
    f"\t\t\tpreferredProjectObjectVersion = 77;\n\t\t\tproductRefGroup = {PRODUCTS_GROUP} /* Products */;\n"
    f"\t\t\tprojectDirPath = \"\";\n\t\t\tprojectRoot = \"\";\n\t\t\ttargets = (\n{tl}\t\t\t);\n\t\t}};\n"
)
o.append("/* End PBXProject section */\n")

# Resources / Sources phases
o.append("\n/* Begin PBXResourcesBuildPhase section */\n")
for t in targets:
    o.append(f"\t\t{t['phase_resources']} /* Resources */ = {{\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
o.append("/* End PBXResourcesBuildPhase section */\n")
o.append("\n/* Begin PBXSourcesBuildPhase section */\n")
for t in targets:
    o.append(f"\t\t{t['phase_sources']} /* Sources */ = {{\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n")
o.append("/* End PBXSourcesBuildPhase section */\n")

# PBXTargetDependency
o.append("\n/* Begin PBXTargetDependency section */\n")
for t in targets:
    for e in t.get("embeds_ext", []) + t.get("embeds_watch", []):
        o.append(f"\t\t{depid(t, e)} /* PBXTargetDependency */ = {{\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = {by_name[e]['id']} /* {e} */;\n\t\t\ttargetProxy = {proxyid(t, e)} /* PBXContainerItemProxy */;\n\t\t}};\n")
o.append("/* End PBXTargetDependency section */\n")

# XCBuildConfiguration
PROJECT_COMMON = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS": "YES",
    "CLANG_ANALYZER_NONNULL": "YES",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "CLANG_ENABLE_OBJC_WEAK": "YES",
    "CLANG_WARN_DOCUMENTATION_COMMENTS": "YES",
    "CLANG_WARN_UNGUARDED_AVAILABILITY": "YES_AGGRESSIVE",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "GCC_NO_COMMON_BLOCKS": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "18.0",
    "WATCHOS_DEPLOYMENT_TARGET": "11.0",
    "LOCALIZATION_PREFERS_STRING_CATALOGS": "YES",
    "STRING_CATALOG_GENERATE_SYMBOLS": "NO",
    "SWIFT_VERSION": "6.0",
}
PROJECT_DEBUG = {**PROJECT_COMMON,
    "DEBUG_INFORMATION_FORMAT": "dwarf", "ENABLE_TESTABILITY": "YES", "GCC_DYNAMIC_NO_PIC": "NO",
    "GCC_OPTIMIZATION_LEVEL": "0", "GCC_PREPROCESSOR_DEFINITIONS": ["DEBUG=1", "$(inherited)"],
    "MTL_ENABLE_DEBUG_INFO": "INCLUDE_SOURCE", "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG $(inherited)", "SWIFT_OPTIMIZATION_LEVEL": "-Onone"}
PROJECT_RELEASE = {**PROJECT_COMMON,
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym", "ENABLE_NS_ASSERTIONS": "NO", "MTL_ENABLE_DEBUG_INFO": "NO",
    "SWIFT_COMPILATION_MODE": "wholemodule", "VALIDATE_PRODUCT": "YES"}

o.append("\n/* Begin XCBuildConfiguration section */\n")
def conf(id_, name, s):
    o.append(f"\t\t{id_} /* {name} */ = {{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {{\n{settings_block(s)}\t\t\t}};\n\t\t\tname = {name};\n\t\t}};\n")
conf(oid("debug:project"), "Debug", PROJECT_DEBUG)
conf(oid("release:project"), "Release", PROJECT_RELEASE)
for t in targets:
    conf(t["debug"], "Debug", t["settings"])
    conf(t["release"], "Release", t["settings"])
o.append("/* End XCBuildConfiguration section */\n")

# XCConfigurationList
o.append("\n/* Begin XCConfigurationList section */\n")
def clist(id_, label, d, r):
    o.append(f"\t\t{id_} /* Build configuration list for {label} */ = {{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t{d} /* Debug */,\n\t\t\t\t{r} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t}};\n")
clist(oid("configlist:project"), 'PBXProject "Contrail"', oid("debug:project"), oid("release:project"))
for t in targets:
    clist(t["config_list"], f'PBXNativeTarget "{t["name"]}"', t["debug"], t["release"])
o.append("/* End XCConfigurationList section */\n")

# Packages
o.append("\n/* Begin XCLocalSwiftPackageReference section */\n")
o.append(f"\t\t{PKG_REF} /* XCLocalSwiftPackageReference \"ContrailKit\" */ = {{\n\t\t\tisa = XCLocalSwiftPackageReference;\n\t\t\trelativePath = ContrailKit;\n\t\t}};\n")
o.append("/* End XCLocalSwiftPackageReference section */\n")
o.append("\n/* Begin XCSwiftPackageProductDependency section */\n")
for t in targets:
    for p in PRODUCTS:
        o.append(f"\t\t{t['pkgdeps'][p]} /* {p} */ = {{\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = {PKG_REF} /* XCLocalSwiftPackageReference \"ContrailKit\" */;\n\t\t\tproductName = {p};\n\t\t}};\n")
o.append("/* End XCSwiftPackageProductDependency section */\n")

o.append(f"\t}};\n\trootObject = {PROJECT} /* Project object */;\n}}\n")

proj = os.path.join(ROOT, "Contrail.xcodeproj")
os.makedirs(os.path.join(proj, "project.xcworkspace"), exist_ok=True)
with open(os.path.join(proj, "project.pbxproj"), "w") as f:
    f.write("".join(o))
with open(os.path.join(proj, "project.xcworkspace", "contents.xcworkspacedata"), "w") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<Workspace\n   version = "1.0">\n   <FileRef\n      location = "self:">\n   </FileRef>\n</Workspace>\n')

# Shared scheme for the app (builds widgets + watch through dependencies, runs package tests).
scheme_dir = os.path.join(proj, "xcshareddata", "xcschemes")
os.makedirs(scheme_dir, exist_ok=True)
app = by_name["Contrail"]
ref = f'''<BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{app['id']}"
               BuildableName = "Contrail.app"
               BlueprintName = "Contrail"
               ReferencedContainer = "container:Contrail.xcodeproj">
            </BuildableReference>'''
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "2600"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            {ref}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference
            skipped = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "VatCoreTests"
               BuildableName = "VatCoreTests"
               BlueprintName = "VatCoreTests"
               ReferencedContainer = "container:ContrailKit">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
'''
with open(os.path.join(scheme_dir, "Contrail.xcscheme"), "w") as f:
    f.write(scheme)
print("Generated", proj)
