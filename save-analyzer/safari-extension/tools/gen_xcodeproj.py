"""Generates ios/SaveForge.xcodeproj/project.pbxproj (iOS app + Safari Web Extension).

The layout matches what Xcode's "Safari Extension App" template and
`xcrun safari-web-extension-converter` produce:
  - SaveForge (iOS app, SwiftUI) embeds "SaveForge Extension.appex"
  - the extension's web resources are referenced from ../extension (not copied),
    top-level files individually and images/_locales as folder references, so
    manifest.json lands at the root of the .appex bundle.

Object IDs are derived from stable names, so regenerating gives the same file.
Run: python3 tools/gen_xcodeproj.py
"""

import hashlib
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'ios', 'SaveForge.xcodeproj')
DEPLOYMENT_TARGET = '15.4'


def oid(name):
    return hashlib.sha1(name.encode()).hexdigest()[:24].upper()


SAFE = re.compile(r'^[A-Za-z0-9_./]+$')


def q(v):
    if isinstance(v, str):
        if v and SAFE.match(v) and not v.startswith('//'):
            return v
        return '"' + v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'
    raise TypeError(v)


def ser(v, ind):
    pad = '\t' * ind
    if isinstance(v, dict):
        if not v:
            return '{\n' + pad + '}'
        out = '{\n'
        for k, x in v.items():
            out += pad + '\t' + q(k) + ' = ' + ser(x, ind + 1) + ';\n'
        return out + pad + '}'
    if isinstance(v, list):
        if not v:
            return '(\n' + pad + ')'
        out = '(\n'
        for x in v:
            out += pad + '\t' + ser(x, ind + 1) + ',\n'
        return out + pad + ')'
    if isinstance(v, int):
        return str(v)
    return q(v)


objects = {}


def add(isa, key, **props):
    i = oid(key)
    objects[i] = {'isa': isa, **props}
    return i


# ---------------------------------------------------------------- file references
def fref(key, path, ftype, source='<group>', **extra):
    return add('PBXFileReference', 'file:' + key, lastKnownFileType=ftype, path=path, sourceTree=source, **extra)


app_swift = fref('SaveForgeApp.swift', 'SaveForgeApp.swift', 'sourcecode.swift')
content_swift = fref('ContentView.swift', 'ContentView.swift', 'sourcecode.swift')
assets = fref('Assets.xcassets', 'Assets.xcassets', 'folder.assetcatalog')
handler_swift = fref('SafariWebExtensionHandler.swift', 'SafariWebExtensionHandler.swift', 'sourcecode.swift')
ext_plist = fref('ext-Info.plist', 'Info.plist', 'text.plist.xml')
web = {
    'manifest.json': fref('manifest.json', 'manifest.json', 'text.json'),
    'background.js': fref('background.js', 'background.js', 'sourcecode.javascript'),
    'inject-fallback.js': fref('inject-fallback.js', 'inject-fallback.js', 'sourcecode.javascript'),
    'trainer.js': fref('trainer.js', 'trainer.js', 'sourcecode.javascript'),
    'images': fref('images', 'images', 'folder'),
    '_locales': fref('_locales', '_locales', 'folder'),
}
app_product = add('PBXFileReference', 'product:app', explicitFileType='wrapper.application', includeInIndex=0, path='SaveForge.app', sourceTree='BUILT_PRODUCTS_DIR')
ext_product = add('PBXFileReference', 'product:appex', explicitFileType='wrapper.app-extension', includeInIndex=0, path='SaveForge Extension.appex', sourceTree='BUILT_PRODUCTS_DIR')
safari_fw = add('PBXFileReference', 'file:SafariServices.framework', lastKnownFileType='wrapper.framework', name='SafariServices.framework', path='System/Library/Frameworks/SafariServices.framework', sourceTree='SDKROOT')

# ---------------------------------------------------------------- build files
def bfile(key, ref, **extra):
    return add('PBXBuildFile', 'build:' + key, fileRef=ref, **extra)


b_app_swift = bfile('SaveForgeApp.swift', app_swift)
b_content = bfile('ContentView.swift', content_swift)
b_assets = bfile('Assets.xcassets', assets)
b_handler = bfile('SafariWebExtensionHandler.swift', handler_swift)
b_web = [bfile('res:' + k, v) for k, v in web.items()]
b_fw = bfile('SafariServices.framework', safari_fw)
b_embed = bfile('embed:appex', ext_product, settings={'ATTRIBUTES': ['RemoveHeadersOnCopy']})

# ---------------------------------------------------------------- groups
g_app = add('PBXGroup', 'group:SaveForge', children=[app_swift, content_swift, assets], path='SaveForge', sourceTree='<group>')
g_ext = add('PBXGroup', 'group:Extension', children=[handler_swift, ext_plist], path='SaveForge Extension', sourceTree='<group>')
g_web = add('PBXGroup', 'group:WebResources', children=list(web.values()), name='Web Extension Resources', path='../extension', sourceTree='<group>')
g_fw = add('PBXGroup', 'group:Frameworks', children=[safari_fw], name='Frameworks', sourceTree='<group>')
g_products = add('PBXGroup', 'group:Products', children=[app_product, ext_product], name='Products', sourceTree='<group>')
g_main = add('PBXGroup', 'group:main', children=[g_app, g_ext, g_web, g_fw, g_products], sourceTree='<group>')

# ---------------------------------------------------------------- build phases
def phase(isa, key, files, **extra):
    return add(isa, 'phase:' + key, buildActionMask=2147483647, files=files, runOnlyForDeploymentPostprocessing=0, **extra)


app_sources = phase('PBXSourcesBuildPhase', 'app-sources', [b_app_swift, b_content])
app_frameworks = phase('PBXFrameworksBuildPhase', 'app-frameworks', [])
app_resources = phase('PBXResourcesBuildPhase', 'app-resources', [b_assets])
app_embed = phase('PBXCopyFilesBuildPhase', 'app-embed', [b_embed], dstPath='', dstSubfolderSpec=13, name='Embed Foundation Extensions')
ext_sources = phase('PBXSourcesBuildPhase', 'ext-sources', [b_handler])
ext_frameworks = phase('PBXFrameworksBuildPhase', 'ext-frameworks', [b_fw])
ext_resources = phase('PBXResourcesBuildPhase', 'ext-resources', b_web)

# ---------------------------------------------------------------- build settings
COMMON = {
    'ALWAYS_SEARCH_USER_PATHS': 'NO',
    'CLANG_ANALYZER_NONNULL': 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD': 'gnu++20',
    'CLANG_ENABLE_MODULES': 'YES',
    'CLANG_ENABLE_OBJC_ARC': 'YES',
    'CLANG_WARN_DOCUMENTATION_COMMENTS': 'YES',
    'COPY_PHASE_STRIP': 'NO',
    'ENABLE_STRICT_OBJC_MSGSEND': 'YES',
    'ENABLE_USER_SCRIPT_SANDBOXING': 'YES',
    'GCC_C_LANGUAGE_STANDARD': 'gnu17',
    'GCC_NO_COMMON_BLOCKS': 'YES',
    'IPHONEOS_DEPLOYMENT_TARGET': DEPLOYMENT_TARGET,
    'MTL_FAST_MATH': 'YES',
    'SDKROOT': 'iphoneos',
    # Change this once (Build Settings → User-Defined) to your own reverse-DNS prefix.
    'SAVEFORGE_BUNDLE_PREFIX': 'com.example',
}
DEBUG = {
    **COMMON,
    'DEBUG_INFORMATION_FORMAT': 'dwarf',
    'ENABLE_TESTABILITY': 'YES',
    'GCC_DYNAMIC_NO_PIC': 'NO',
    'GCC_OPTIMIZATION_LEVEL': '0',
    'GCC_PREPROCESSOR_DEFINITIONS': ['DEBUG=1', '$(inherited)'],
    'MTL_ENABLE_DEBUG_INFO': 'INCLUDE_SOURCE',
    'ONLY_ACTIVE_ARCH': 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG $(inherited)',
    'SWIFT_OPTIMIZATION_LEVEL': '-Onone',
}
RELEASE = {
    **COMMON,
    'DEBUG_INFORMATION_FORMAT': 'dwarf-with-dsym',
    'ENABLE_NS_ASSERTIONS': 'NO',
    'MTL_ENABLE_DEBUG_INFO': 'NO',
    'SWIFT_COMPILATION_MODE': 'wholemodule',
    'VALIDATE_PRODUCT': 'YES',
}
APP = {
    'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon',
    'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME': 'AccentColor',
    'CODE_SIGN_STYLE': 'Automatic',
    'CURRENT_PROJECT_VERSION': '1',
    'DEVELOPMENT_TEAM': '',
    'GENERATE_INFOPLIST_FILE': 'YES',
    'INFOPLIST_KEY_CFBundleDisplayName': 'SaveForge',
    'INFOPLIST_KEY_LSApplicationCategoryType': 'public.app-category.utilities',
    'INFOPLIST_KEY_UIApplicationSceneManifest_Generation': 'YES',
    'INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents': 'YES',
    'INFOPLIST_KEY_UILaunchScreen_Generation': 'YES',
    'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad': 'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight',
    'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone': 'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight',
    'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks'],
    'MARKETING_VERSION': '1.0',
    'PRODUCT_BUNDLE_IDENTIFIER': '$(SAVEFORGE_BUNDLE_PREFIX).SaveForge',
    'PRODUCT_NAME': '$(TARGET_NAME)',
    'SWIFT_EMIT_LOC_STRINGS': 'YES',
    'SWIFT_VERSION': '5.0',
    'TARGETED_DEVICE_FAMILY': '1,2',
}
EXT = {
    'CODE_SIGN_STYLE': 'Automatic',
    'CURRENT_PROJECT_VERSION': '1',
    'DEVELOPMENT_TEAM': '',
    'GENERATE_INFOPLIST_FILE': 'YES',
    'INFOPLIST_FILE': 'SaveForge Extension/Info.plist',
    'INFOPLIST_KEY_CFBundleDisplayName': 'SaveForge Trainer',
    'INFOPLIST_KEY_NSHumanReadableCopyright': '',
    'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
    'MARKETING_VERSION': '1.0',
    'PRODUCT_BUNDLE_IDENTIFIER': '$(SAVEFORGE_BUNDLE_PREFIX).SaveForge.Extension',
    'PRODUCT_NAME': '$(TARGET_NAME)',
    'SKIP_INSTALL': 'YES',
    'SWIFT_EMIT_LOC_STRINGS': 'YES',
    'SWIFT_VERSION': '5.0',
    'TARGETED_DEVICE_FAMILY': '1,2',
}


def configs(name, debug, release):
    d = add('XCBuildConfiguration', f'cfg:{name}:Debug', buildSettings=debug, name='Debug')
    r = add('XCBuildConfiguration', f'cfg:{name}:Release', buildSettings=release, name='Release')
    return add('XCConfigurationList', f'cfglist:{name}', buildConfigurations=[d, r], defaultConfigurationIsVisible=0, defaultConfigurationName='Release')


proj_cfg = configs('project', DEBUG, RELEASE)
app_cfg = configs('app', APP, APP)
ext_cfg = configs('ext', EXT, EXT)

# ---------------------------------------------------------------- targets
ext_target = add(
    'PBXNativeTarget', 'target:ext', buildConfigurationList=ext_cfg, buildPhases=[ext_sources, ext_frameworks, ext_resources],
    buildRules=[], dependencies=[], name='SaveForge Extension', productName='SaveForge Extension', productReference=ext_product,
    productType='com.apple.product-type.app-extension',
)
proj_id = oid('project')
proxy = add('PBXContainerItemProxy', 'proxy:ext', containerPortal=proj_id, proxyType='1', remoteGlobalIDString=ext_target, remoteInfo='SaveForge Extension')
dep = add('PBXTargetDependency', 'dep:ext', target=ext_target, targetProxy=proxy)
app_target = add(
    'PBXNativeTarget', 'target:app', buildConfigurationList=app_cfg, buildPhases=[app_sources, app_frameworks, app_resources, app_embed],
    buildRules=[], dependencies=[dep], name='SaveForge', productName='SaveForge', productReference=app_product,
    productType='com.apple.product-type.application',
)
objects[proj_id] = {
    'isa': 'PBXProject',
    'attributes': {
        'BuildIndependentTargetsInParallel': '1',
        'LastSwiftUpdateCheck': '1500',
        'LastUpgradeCheck': '1500',
        'TargetAttributes': {app_target: {'CreatedOnToolsVersion': '15.0'}, ext_target: {'CreatedOnToolsVersion': '15.0'}},
    },
    'buildConfigurationList': proj_cfg,
    'compatibilityVersion': 'Xcode 14.0',
    'developmentRegion': 'en',
    'hasScannedForEncodings': 0,
    'knownRegions': ['en', 'Base'],
    'mainGroup': g_main,
    'productRefGroup': g_products,
    'projectDirPath': '',
    'projectRoot': '',
    'targets': [app_target, ext_target],
}

# ---------------------------------------------------------------- write
ORDER = ['PBXBuildFile', 'PBXContainerItemProxy', 'PBXCopyFilesBuildPhase', 'PBXFileReference', 'PBXFrameworksBuildPhase', 'PBXGroup', 'PBXNativeTarget', 'PBXProject', 'PBXResourcesBuildPhase', 'PBXSourcesBuildPhase', 'PBXTargetDependency', 'XCBuildConfiguration', 'XCConfigurationList']
out = '// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n'
for isa in ORDER:
    ids = sorted(i for i, o in objects.items() if o['isa'] == isa)
    if not ids:
        continue
    out += f'\n/* Begin {isa} section */\n'
    for i in ids:
        o = objects[i]
        body = {'isa': isa, **{k: v for k, v in o.items() if k != 'isa'}}
        out += '\t\t' + i + ' = ' + ser(body, 2) + ';\n'
    out += f'/* End {isa} section */\n'
out += '\t};\n\trootObject = ' + proj_id + ';\n}\n'

os.makedirs(os.path.join(OUT, 'project.xcworkspace'), exist_ok=True)
with open(os.path.join(OUT, 'project.pbxproj'), 'w') as f:
    f.write(out)
with open(os.path.join(OUT, 'project.xcworkspace', 'contents.xcworkspacedata'), 'w') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<Workspace\n   version = "1.0">\n   <FileRef\n      location = "self:">\n   </FileRef>\n</Workspace>\n')
print(f'wrote {len(objects)} objects')
