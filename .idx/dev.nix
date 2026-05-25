# Google Project IDX Configuration File
# For documentation, see https://developers.google.com/idx/guides/customize-idx-env

{ pkgs, ... }: {
  # Which channel of the Nixpkgs repository to use
  channel = "stable-23.11";

  # Use https://search.nixos.org/packages to find packages
  packages = [
    pkgs.nodejs_20
    pkgs.sqlite
  ];

  # Sets environment variables in the workspace
  env = {
    PORT = "3000";
    NODE_ENV = "development";
  };

  idx = {
    # Extensions you want in the VS Code browser editor
    extensions = [
      "dbaeumer.vscode-eslint"
      "qwtel.sqlite-viewer"
    ];

    # Workspace lifecycle hooks
    workspace = {
      # Runs when a workspace is first created
      onCreate = "npm install && npm install --save-dev nodemon";
      # Runs when a workspace is (re)started
      onStart = "npm run dev";
    };

    # Enable previews
    previews = {
      enable = true;
      previews = {
        web = {
          # Command to start the dev server
          command = ["npm" "run" "dev"];
          manager = "web";
          env = {
            PORT = "$PORT";
          };
        };
      };
    };
  };
}
