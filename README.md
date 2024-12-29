# George
This program automatically applies a layout to a [Garage](https://garagehq.deuxfleurs.fr/) cluster based on Docker Swarm labels. [Consul](https://www.consul.io/) should be used for gossiping among Garage nodes.

Once the Garage nodes have all found one another, there is no longer a need for Consul; therefore, a single Consul node (as opposed to a high-availability Consul cluster) is sufficient to bootstrap a Garage cluster.
