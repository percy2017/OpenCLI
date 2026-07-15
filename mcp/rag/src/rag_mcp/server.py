import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stderr,
)

from mcp.server.fastmcp import FastMCP

from .tools import register_tools

mcp = FastMCP("rag_mcp")
register_tools(mcp)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
