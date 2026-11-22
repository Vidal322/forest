{
  description = "Forest — reforestation field tracker (Go backend + React frontend)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # backend
            go
            gopls
            gotools
            golangci-lint
            goose
            # frontend
            nodejs_22
            pnpm
            # database client (the server itself runs in Docker)
            postgresql
          ];
        };
      });
}
