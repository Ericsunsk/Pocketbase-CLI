from setuptools import find_namespace_packages, setup


setup(
    name="cli-anything-pocketbase",
    version="0.1.0",
    description="Remote-only CLI-Anything harness for PocketBase",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    include_package_data=True,
    install_requires=["click>=8.1.7"],
    python_requires=">=3.9",
    entry_points={
        "console_scripts": [
            "cli-anything-pocketbase=cli_anything.pocketbase.pocketbase_cli:cli",
        ],
    },
)
