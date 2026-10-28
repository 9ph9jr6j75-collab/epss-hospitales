#!/usr/bin/env python3
"""Compatibility entry point for the hospital catalog checks."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('verify-hospital-catalog.py')), run_name='__main__')
