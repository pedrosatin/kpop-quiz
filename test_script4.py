import sys
import coverage
import unittest
cov = coverage.Coverage(source=['kpop_scraping.grid_cli'])
cov.start()
suite = unittest.defaultTestLoader.discover('tests', pattern='test_grid*.py')
unittest.TextTestRunner().run(suite)
cov.stop()
cov.report(show_missing=True)
