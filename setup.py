from setuptools import find_packages, setup


setup(
    name="pocketbase-cli",
    version="0.1.0",
    description="Remote-only PocketBase CLI for deployed PocketBase instances",
    packages=find_packages(include=["pocketbase_cli", "pocketbase_cli.*"]),
    include_package_data=True,
    install_requires=["click>=8.1.7"],
    python_requires=">=3.9",
    entry_points={
        "console_scripts": [
            "pocketbase-cli=pocketbase_cli.pocketbase_cli:cli",
        ],
    },
)
