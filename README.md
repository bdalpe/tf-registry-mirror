# TF Registry Mirror

This project is an implementation of the [Terraform/OpenTofu Provider Network Mirror Protocol](https://developer.hashicorp.com/terraform/internals/provider-network-mirror-protocol) which provides online caching of Providers and Modules. Instead of running `terraform providers mirror`, you can connect to the proxy server which will serve the correct responses back to the `terraform`/`tofu` client.

The [src](src) folder contains code that converts JSON data from the online registry into the expected Mirror server JSON responses. Provider file caching is handled by a separate NGINX instance.

## Configuring

For configuring Provider installation using the proxy mirror, follow the [instructions to configure](https://developer.hashicorp.com/terraform/cli/config/config-file#network_mirror) your code:

```terraform
provider_installation {
  network_mirror {
    url = "https://mirror.example.com/v1/providers/"
  }
}
```

The mirror also handles requests for module information, but does not cache the upstream data files due to how the protocol works.

```terraform
module "example" {
  source = "mirror.example.com/path/to/module"
  ...
}
```
