# -*- mode: python ; coding: utf-8 -*-
# ملف تغليف PyInstaller — يُشغَّل من جذر المشروع على جهاز ويندوز:
#   pyinstaller packaging/app.spec
# الناتج: dist/نظام-عضوية-الجمعية/نظام-عضوية-الجمعية.exe

import os

block_cipher = None
project_root = os.path.abspath(os.path.join(os.path.dirname(SPEC), ".."))

a = Analysis(
    [os.path.join(project_root, "app", "main.py")],
    pathex=[project_root],
    binaries=[],
    datas=[
        (os.path.join(project_root, "app", "resources", "fonts"), "app/resources/fonts"),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="نظام-عضوية-الجمعية",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="نظام-عضوية-الجمعية",
)

